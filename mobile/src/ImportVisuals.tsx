import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Icon from './icons';
import LogoMark from './LogoMark';
import { colors, fonts, inkAlpha, radii, spacing } from './theme';

/**
 * The moving parts of the import screen.
 *
 * Everything here that loops or springs stops doing so when the device asks
 * for reduced motion, and still shows the same information: motion is added to
 * the state, never the only way of seeing it.
 */

/** Whether the device has asked for less movement. Assumes not until it says so. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        if (live) setReduced(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

/** A fraction of work done, kept within 0 and 1 whatever it is handed. */
export function clampFraction(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(1, Math.max(0, done / total));
}

export const IMPORT_STEPS = ['Choose', 'Review', 'Import'] as const;

/** Which step is current, or all of them once it is over. */
export function stepIndex(stage: 'pick' | 'preview' | 'importing' | 'done'): number {
  switch (stage) {
    case 'pick':
      return 0;
    case 'preview':
      return 1;
    case 'importing':
      return 2;
    case 'done':
      return IMPORT_STEPS.length;
  }
}

/** Choose, Review, Import: where this is, and what is already behind it. */
export function Steps(props: { current: number }) {
  return (
    <View
      style={styles.steps}
      accessible
      accessibilityLabel={`Step ${String(Math.min(props.current + 1, IMPORT_STEPS.length))} of ${String(IMPORT_STEPS.length)}`}
    >
      {IMPORT_STEPS.map((label, index) => {
        const done = index < props.current;
        const active = index === props.current;
        return (
          <View key={label} style={styles.stepGroup}>
            {index > 0 && <View style={[styles.stepLine, index <= props.current && styles.stepLineOn]} />}
            <View style={styles.step}>
              <View style={[styles.stepDot, (done || active) && styles.stepDotOn]}>
                {done ? (
                  <Icon name="check" size={13} color={colors.onInk} />
                ) : (
                  <Text style={[styles.stepNumber, active && styles.stepNumberOn]}>{String(index + 1)}</Text>
                )}
              </View>
              <Text style={[styles.stepLabel, active && styles.stepLabelOn]}>{label}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** The dial, turning while work is going on. */
export function SpinningDial(props: { size?: number }) {
  const reduced = useReducedMotion();
  const turn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(
      Animated.timing(turn, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, turn]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <LogoMark size={props.size ?? 84} variant="syncing" color={colors.ink} stateColor={colors.amber} />
    </Animated.View>
  );
}

/** A bar that fills as `fraction` grows, easing between values rather than jumping. */
export function ProgressBar(props: { fraction: number; label: string }) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const fill = useRef(new Animated.Value(0)).current;
  const fraction = clampFraction(props.fraction, 1);

  useEffect(() => {
    if (reduced) {
      fill.setValue(fraction);
      return;
    }
    Animated.timing(fill, { toValue: fraction, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [fraction, fill, reduced]);

  // Slid in from the left rather than resized, so it can use the native driver.
  const translateX = fill.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] });
  return (
    <View
      style={styles.track}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={props.label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
    >
      <Animated.View style={[styles.fill, { transform: [{ translateX }] }]} />
    </View>
  );
}

/** The badge at the end: springs in, with a tick when everything went in and a mark when not. */
export function ResultBadge(props: { ok: boolean }) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(reduced ? 1 : 0.5)).current;

  useEffect(() => {
    if (reduced) {
      scale.setValue(1);
      return;
    }
    Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }).start();
  }, [reduced, scale]);

  return (
    <Animated.View
      style={[styles.badge, !props.ok && styles.badgePartial, { transform: [{ scale }] }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Icon name={props.ok ? 'check' : 'alertTriangle'} size={34} color={props.ok ? colors.onInk : colors.amber} />
    </Animated.View>
  );
}

/** The pick screen's picture: a dashed ring that breathes, around the import arrow. */
export function PickArt() {
  const reduced = useReducedMotion();
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, breathe]);

  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  return (
    <Animated.View style={[styles.pickArt, { transform: [{ scale }] }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Icon name="import" size={34} color={colors.ink} />
    </Animated.View>
  );
}

/** One number and what it counts. */
export function StatTile(props: { value: number; label: string; tone?: 'plain' | 'good' | 'warn' }) {
  return (
    <View style={[styles.tile, props.tone === 'warn' && styles.tileWarn]}>
      <Text style={styles.tileValue}>{String(props.value)}</Text>
      <Text style={styles.tileLabel}>{props.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  stepGroup: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stepLine: { flex: 1, height: 2, backgroundColor: inkAlpha(0.18), marginHorizontal: 6, borderRadius: 1 },
  stepLineOn: { backgroundColor: colors.ink },
  step: { alignItems: 'center', gap: 4 },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: inkAlpha(0.35),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  stepDotOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  stepNumber: { fontFamily: fonts.semiCondensedSemiBold, fontSize: 12, color: colors.ink },
  stepNumberOn: { color: colors.onInk },
  stepLabel: { fontFamily: fonts.body, fontSize: 11.5, color: colors.ink, opacity: 0.6 },
  stepLabelOn: { opacity: 1, fontFamily: fonts.semiCondensedSemiBold },
  track: { height: 10, borderRadius: 5, backgroundColor: inkAlpha(0.14), overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.ink, borderRadius: 5 },
  badge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgePartial: { backgroundColor: colors.card, borderWidth: 3, borderColor: colors.amber },
  pickArt: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: inkAlpha(0.4),
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: inkAlpha(0.14),
    backgroundColor: colors.card,
    gap: 2,
  },
  tileWarn: { borderColor: colors.amber },
  tileValue: { fontFamily: fonts.condensedBold, fontSize: 26, color: colors.ink },
  tileLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.ink, textAlign: 'center' },
});
