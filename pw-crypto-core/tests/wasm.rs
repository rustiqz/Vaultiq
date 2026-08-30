//! Browser tests for the `wasm_bindgen` layer.
//!
//! These run in a real browser via `wasm-pack test --headless --firefox`.
//! Running them on the host would defeat the point: the whole reason this
//! layer exists is the browser, and `SysRng` resolves to a different backend
//! there. A host-only test cannot tell whether `Crypto.getRandomValues` is
//! actually reachable.

#![cfg(all(target_arch = "wasm32", feature = "wasm"))]

use pw_crypto_core::wasm::*;
use wasm_bindgen::JsValue;
use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

wasm_bindgen_test_configure!(run_in_browser);

/// Test-only password. Never a real one, even in a browser (CLAUDE.md §2.6).
const TEST_PASSWORD: &str = "correct horse battery staple";
const TEST_JSON: &str = r#"{"username":"ada@example.test","password":"hunter2"}"#;

/// Cheap Argon2 parameters. The KDF is deliberately slow, and a browser test
/// runner is the worst place to spend 64 MiB three times over; correctness of
/// the *derivation* is pinned by the known-answer vectors in `kdf`.
fn params() -> (u32, u32, u32) {
    (19 * 1024, 2, 1)
}

fn header(id: &str) -> JsValue {
    let obj = js_sys::Object::new();
    let set = |k: &str, v: JsValue| {
        js_sys::Reflect::set(&obj, &JsValue::from_str(k), &v).unwrap();
    };
    set("id", JsValue::from_str(id));
    set("item_type", JsValue::from_str("login"));
    set("version", JsValue::from_f64(1.0));
    set("updated_at", JsValue::from_f64(1_756_000_000_000.0));
    set("deleted", JsValue::from_bool(false));
    obj.into()
}

fn master_key(salt: &str) -> MasterKeyHandle {
    let (m, t, p) = params();
    derive_master_key(TEST_PASSWORD, salt, m, t, p).unwrap()
}

// --- The browser CSPRNG is actually reachable ---

#[wasm_bindgen_test]
fn csprng_works_in_the_browser() {
    // This is the test that PR #2's build fix exists for: if getrandom has no
    // browser backend, every one of these panics at runtime rather than at
    // compile time.
    let a = generate_salt().unwrap();
    let b = generate_salt().unwrap();
    assert_ne!(a, b, "two CSPRNG salts must not collide");
    assert!(!a.is_empty());

    let k1 = generate_vault_key().unwrap();
    let k2 = generate_vault_key().unwrap();
    k1.lock();
    k2.lock();
}

// --- Round trips through the JS boundary ---

#[wasm_bindgen_test]
fn vault_key_wraps_and_unwraps() {
    let salt = generate_salt().unwrap();
    let mk = master_key(&salt);
    let vault_key = generate_vault_key().unwrap();

    let wrapped = wrap_vault_key(&vault_key, &mk).unwrap();
    let unwrapped = unwrap_vault_key(wrapped, &mk).unwrap();

    // Prove it is the same key by using it, since the bytes never surface.
    let item = encrypt_item_js(TEST_JSON, header("a"), &vault_key).unwrap();
    assert_eq!(decrypt_item_js(item, &unwrapped).unwrap(), TEST_JSON);
}

#[wasm_bindgen_test]
fn item_encrypts_and_decrypts() {
    let vault_key = generate_vault_key().unwrap();
    let item = encrypt_item_js(TEST_JSON, header("a"), &vault_key).unwrap();
    assert_eq!(decrypt_item_js(item, &vault_key).unwrap(), TEST_JSON);
}

#[wasm_bindgen_test]
fn derivation_is_deterministic_across_the_boundary() {
    let salt = generate_salt().unwrap();
    let auth_a = derive_auth_key(&master_key(&salt)).unwrap();
    let auth_b = derive_auth_key(&master_key(&salt)).unwrap();
    assert_eq!(auth_a, auth_b);

    let other_salt = generate_salt().unwrap();
    assert_ne!(auth_a, derive_auth_key(&master_key(&other_salt)).unwrap());
}

#[wasm_bindgen_test]
fn encryption_never_reuses_a_nonce() {
    // There is no nonce parameter on the JS surface at all; this confirms the
    // one generated internally differs per call.
    let vault_key = generate_vault_key().unwrap();
    let first = encrypt_item_js(TEST_JSON, header("a"), &vault_key).unwrap();
    let second = encrypt_item_js(TEST_JSON, header("a"), &vault_key).unwrap();

    let nonce = |v: &JsValue| {
        js_sys::Reflect::get(v, &JsValue::from_str("nonce"))
            .unwrap()
            .as_string()
            .unwrap_or_else(|| format!("{:?}", js_sys::JSON::stringify(v).unwrap()))
    };
    assert_ne!(nonce(&first), nonce(&second));
}

// --- The security property this boundary exists to preserve ---

fn error_message(err: wasm_bindgen::JsError) -> String {
    let value: JsValue = err.into();
    js_sys::Reflect::get(&value, &JsValue::from_str("message"))
        .ok()
        .and_then(|m| m.as_string())
        .unwrap_or_default()
}

#[wasm_bindgen_test]
fn every_crypto_failure_looks_identical_to_javascript() {
    // CLAUDE.md §2.4 holds at the trust boundary, not just inside Rust. If a
    // future edit lets one failure mode say something different, that is a
    // decryption oracle handed straight to a compromised page.
    let vault_key = generate_vault_key().unwrap();
    let wrong_key = generate_vault_key().unwrap();
    let item = encrypt_item_js(TEST_JSON, header("a"), &vault_key).unwrap();

    // wrong key
    let e1 = decrypt_item_js(item.clone(), &wrong_key).unwrap_err();

    // tampered ciphertext
    let tampered = item.clone();
    let ct = js_sys::Reflect::get(&tampered, &JsValue::from_str("ciphertext")).unwrap();
    let arr = js_sys::Array::from(&ct);
    let first = arr.get(0).as_f64().unwrap();
    arr.set(0, JsValue::from_f64((first as u32 ^ 1) as f64));
    js_sys::Reflect::set(&tampered, &JsValue::from_str("ciphertext"), &arr).unwrap();
    let e2 = decrypt_item_js(tampered, &vault_key).unwrap_err();

    // altered id — bound as associated data
    let moved = item.clone();
    js_sys::Reflect::set(&moved, &JsValue::from_str("id"), &JsValue::from_str("b")).unwrap();
    let e3 = decrypt_item_js(moved, &vault_key).unwrap_err();

    let m1 = error_message(e1);
    let m2 = error_message(e2);
    let m3 = error_message(e3);

    assert_eq!(m1, "decryption failed");
    assert_eq!(
        m1, m2,
        "wrong key and tampered ciphertext must be identical"
    );
    assert_eq!(m1, m3, "wrong key and a moved ciphertext must be identical");
}

#[wasm_bindgen_test]
fn wrong_master_key_cannot_unwrap() {
    let mk = master_key(&generate_salt().unwrap());
    let other = master_key(&generate_salt().unwrap());
    let vault_key = generate_vault_key().unwrap();

    let wrapped = wrap_vault_key(&vault_key, &mk).unwrap();
    let err = unwrap_vault_key(wrapped, &other).unwrap_err();
    assert_eq!(error_message(err), "decryption failed");
}

// --- Surviving a suspended background context ---

#[wasm_bindgen_test]
fn vault_key_survives_a_session_storage_round_trip() {
    // Stands in for the background page being suspended and woken: export,
    // everything in memory goes away, restore, keep working.
    let vault_key = generate_vault_key().unwrap();
    let item = encrypt_item_js(TEST_JSON, header("a"), &vault_key).unwrap();

    let exported = vault_key.export_for_session_storage();
    vault_key.lock();

    let restored = VaultKeyHandle::restore_from_session_storage(&exported).unwrap();
    assert_eq!(decrypt_item_js(item, &restored).unwrap(), TEST_JSON);
}

#[wasm_bindgen_test]
fn a_malformed_session_key_is_rejected() {
    for bad in ["", "not base64!!", "c2hvcnQ="] {
        let err = VaultKeyHandle::restore_from_session_storage(bad).unwrap_err();
        assert_eq!(error_message(err), "invalid argument: session key");
    }
}

// --- Argument validation is separate from crypto failure ---

#[wasm_bindgen_test]
fn malformed_arguments_are_reported_as_such() {
    // A wrong-length salt is a caller bug, not a decryption oracle: it says
    // only that a value the caller just supplied was the wrong shape.
    let (m, t, p) = params();
    let err = derive_master_key(TEST_PASSWORD, "bm90LWEtc2FsdA==", m, t, p).unwrap_err();
    assert_eq!(error_message(err), "invalid argument: salt");

    let err = derive_master_key(TEST_PASSWORD, "!!!not base64!!!", m, t, p).unwrap_err();
    assert_eq!(error_message(err), "invalid argument: salt");
}

#[wasm_bindgen_test]
fn default_params_are_exported() {
    let params = default_argon2_params().unwrap();
    let memory = js_sys::Reflect::get(&params, &JsValue::from_str("memory_kib"))
        .unwrap()
        .as_f64()
        .unwrap();
    assert!(memory >= 19.0 * 1024.0, "must clear the OWASP floor");
    assert_eq!(key_length(), 32);
}
