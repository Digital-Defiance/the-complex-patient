import { Alert, Platform } from 'react-native';

/** Cross-platform alert — `Alert.alert` is unreliable on React Native Web. */
export function showAppAlert(title: string, message: string): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export interface ConfirmAppActionOptions {
  confirmLabel?: string;
  destructive?: boolean;
}

/**
 * Cross-platform confirm dialog. React Native Web does not render multi-button
 * `Alert.alert` prompts, so web uses `window.confirm`.
 */
export function confirmAppAction(
  title: string,
  message: string,
  options: ConfirmAppActionOptions = {},
): Promise<boolean> {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }

  const confirmLabel = options.confirmLabel ?? 'OK';

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: options.destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
