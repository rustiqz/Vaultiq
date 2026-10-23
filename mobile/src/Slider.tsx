import { useRef, useState } from 'react';
import { type AccessibilityActionEvent, type LayoutChangeEvent, PanResponder, StyleSheet, View } from 'react-native';
import { colors, inkAlpha } from './theme';

const THUMB = 26;
const TRACK = 6;

/**
 * A whole-number slider, drawn by hand.
 *
 * React Native has no slider in core, and one control did not justify a
 * dependency. The track is the only touch target (the fill and thumb ignore
 * touches), so `locationX` is always relative to it; a drag adds the finger's
 * movement to where it started. Screen readers get the adjustable role, so a
 * swipe up or down steps the value by one.
 */
export default function Slider(props: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
}) {
  const [width, setWidth] = useState(0);

  // Read through a ref so the responder, created once, never sees stale props.
  const latest = useRef(props);
  latest.current = props;
  const widthRef = useRef(0);
  widthRef.current = width;
  const startX = useRef(0);

  const setFromX = (x: number) => {
    const { min, max, onChange, value } = latest.current;
    const usable = widthRef.current - THUMB;
    if (usable <= 0) return;
    const ratio = Math.min(1, Math.max(0, (x - THUMB / 2) / usable));
    const next = Math.round(min + ratio * (max - min));
    if (next !== value) onChange(next);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // A scroll view must not take the drag halfway through.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: event => {
        startX.current = event.nativeEvent.locationX;
        setFromX(startX.current);
      },
      onPanResponderMove: (_event, gesture) => setFromX(startX.current + gesture.dx),
    }),
  ).current;

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const { value, min, max, onChange } = latest.current;
    if (event.nativeEvent.actionName === 'increment') onChange(Math.min(max, value + 1));
    if (event.nativeEvent.actionName === 'decrement') onChange(Math.max(min, value - 1));
  };

  const ratio = (props.value - props.min) / (props.max - props.min);
  const left = Math.max(0, (width - THUMB) * ratio);

  return (
    <View
      style={styles.hit}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={props.label}
      accessibilityValue={{ min: props.min, max: props.max, now: props.value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAccessibilityAction}
      {...responder.panHandlers}
    >
      <View style={styles.track} pointerEvents="none" />
      <View style={[styles.fill, { width: left + THUMB / 2 }]} pointerEvents="none" />
      <View style={[styles.thumb, { left }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 44, justifyContent: 'center' },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK,
    borderRadius: TRACK / 2,
    backgroundColor: inkAlpha(0.16),
  },
  fill: { position: 'absolute', left: 0, height: TRACK, borderRadius: TRACK / 2, backgroundColor: colors.ink },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.ink,
    borderWidth: 3,
    borderColor: colors.card,
  },
});
