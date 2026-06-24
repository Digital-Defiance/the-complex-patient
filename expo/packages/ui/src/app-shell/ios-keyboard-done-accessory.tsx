/**
 * iOS toolbar with a Done button for keyboards that lack dismiss (number-pad)
 * or when large accessibility text makes the default keyboard hard to escape.
 */

import React from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export const KEYBOARD_DONE_ACCESSORY_ID = 'complex-patient.keyboard-done';

/** @deprecated Use {@link KEYBOARD_DONE_ACCESSORY_ID}. */
export const NUMERIC_INPUT_ACCESSORY_ID = KEYBOARD_DONE_ACCESSORY_ID;

export function IosKeyboardDoneAccessory(): React.ReactElement | null {
  if (Platform.OS !== 'ios') {
    return null;
  }

  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_ACCESSORY_ID}>
      <View style={styles.bar}>
        <Pressable
          onPress={() => Keyboard.dismiss()}
          accessibilityRole="button"
          accessibilityLabel="Dismiss keyboard"
          testID="keyboard-done"
          style={styles.doneButton}
        >
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

/** @deprecated Use {@link IosKeyboardDoneAccessory}. */
export const IosNumericInputAccessory = IosKeyboardDoneAccessory;

/** Props to spread onto TextInput for the shared iOS Done accessory. */
export function keyboardDoneAccessoryProps(): { inputAccessoryViewID?: string } {
  return Platform.OS === 'ios'
    ? { inputAccessoryViewID: KEYBOARD_DONE_ACCESSORY_ID }
    : {};
}

/** @deprecated Use {@link keyboardDoneAccessoryProps}. */
export const numericInputAccessoryProps = keyboardDoneAccessoryProps;

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#c8c8c8',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  doneButton: {
    minHeight: 44,
    minWidth: 64,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  doneText: {
    color: '#0066cc',
    fontSize: 17,
    fontWeight: '600',
  },
});
