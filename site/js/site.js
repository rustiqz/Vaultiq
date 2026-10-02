(function () {
  'use strict';

  const root = document.documentElement;
  const themeButton = document.querySelector('.theme-toggle');
  const menuButton = document.querySelector('.menu-toggle');
  const menu = document.getElementById('main-nav');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const preference = window.matchMedia('(prefers-color-scheme: dark)');

  function currentTheme() {
    return root.dataset.theme || (preference.matches ? 'dark' : 'light');
  }

  function updateThemeButton() {
    if (!themeButton) return;
    const dark = currentTheme() === 'dark';
    themeButton.setAttribute('aria-pressed', String(dark));
    themeButton.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    themeButton.textContent = dark ? 'Light mode' : 'Dark mode';
    if (themeColor) themeColor.content = dark ? '#231913' : '#FFF8E8';
  }

  themeButton?.addEventListener('click', function () {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('vaultiq-theme', next); } catch (_) { /* storage may be disabled */ }
    updateThemeButton();
  });
  preference.addEventListener?.('change', updateThemeButton);
  updateThemeButton();

  menuButton?.addEventListener('click', function () {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu?.classList.toggle('is-open', open);
  });
  function closeMenu() {
    menu?.classList.remove('is-open');
    menuButton?.setAttribute('aria-expanded', 'false');
    menuButton?.setAttribute('aria-label', 'Open menu');
  }
  menu?.addEventListener('click', function (event) {
    if (event.target instanceof HTMLAnchorElement) {
      closeMenu();
    }
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && menu?.classList.contains('is-open')) {
      closeMenu();
      menuButton?.focus();
    }
  });
}());
