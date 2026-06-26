/**
 * @complex-patient/ui — SignInScreen
 *
 * Rendered while the Home_Controller status is `signed-out`. Presents a
 * sign-in form that collects WordPress credentials and routes sign-in through
 * `home.signIn(auth)`.
 *
 * The sign-in screen supports both credential kinds defined by `WordPressAuth`:
 * - JWT token (`{ kind: 'jwt', token }`)
 * - Application Password (`{ kind: 'application-password', username, applicationPassword }`)
 *
 * Requirements: 7.1, 8.2
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Keyboard,
  Platform,
  type TextInputProps,
} from 'react-native';
import { useAppHost } from '../app-host';
import type { WordPressAuth } from '../../app';
import {
  IosKeyboardDoneAccessory,
  keyboardDoneAccessoryProps,
} from '../ios-keyboard-done-accessory';

/** Strip invisible characters Android autofill sometimes injects. */
function normalizeSignInUsername(value: string): string {
  return value
    .trim()
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function normalizeApplicationPassword(value: string): string {
  return value
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '');
}

const applicationPasswordAutofillProps = (): Pick<
  TextInputProps,
  'autoComplete' | 'importantForAutofill' | 'textContentType' | 'passwordRules'
> => {
  if (Platform.OS === 'android') {
    return {
      autoComplete: 'new-password',
      importantForAutofill: 'no',
      textContentType: 'password',
    };
  }
  if (Platform.OS === 'ios') {
    return {
      autoComplete: 'off',
      textContentType: 'newPassword',
      passwordRules: '',
    };
  }
  return {
    autoComplete: 'off',
    textContentType: 'password',
  };
};

export function SignInScreen(): React.ReactElement {
  const { home, refreshHomeStatus } = useAppHost();
  const passwordRef = useRef<TextInput>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignIn = useCallback(async () => {
    if (!home) return;

    const trimmedUsername = normalizeSignInUsername(username);
    const trimmedPassword = normalizeApplicationPassword(password);

    if (!trimmedUsername || !trimmedPassword) {
      setError('Please enter your username and application password.');
      return;
    }

    Keyboard.dismiss();
    setError(null);
    setLoading(true);

    const auth: WordPressAuth = {
      kind: 'application-password',
      username: trimmedUsername,
      applicationPassword: trimmedPassword,
    };

    try {
      const result = await home.signIn(auth);
      if (!result.ok) {
        if (result.reason === 'INVALID_CREDENTIALS') {
          const baseMessage =
            result.detail ??
            'WordPress did not accept those credentials. Use an Application Password from Users → Profile → Application Passwords — not your regular login password. Use your WordPress username (login name), not your email.';
          const androidAutofillHint =
            Platform.OS === 'android'
              ? ' Android password managers often autofill your regular wp-admin password — clear the password field and paste the Application Password manually.'
              : '';
          setError(baseMessage + androidAutofillHint);
        } else {
          setError('Could not reach the sync server. Check your network and backend URL.');
        }
        return;
      }
      refreshHomeStatus();
    } finally {
      setLoading(false);
    }
  }, [home, username, password, refreshHomeStatus]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      accessibilityRole="none"
      accessibilityLabel="Sign in"
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        testID="sign-in-screen"
      >
        <View style={styles.form}>
          <IosKeyboardDoneAccessory />

          <Text style={styles.title}>Sign In</Text>
          <Text style={styles.subtitle}>
            Sign in with your WordPress username and an Application Password from Users → Profile →
            Application Passwords.
          </Text>
          {Platform.OS === 'web' &&
            typeof window !== 'undefined' &&
            (window.location?.hostname === 'localhost' ||
              window.location?.hostname === '127.0.0.1') && (
              <Text style={styles.hint}>
                Local WordPress Studio: open http://localhost:8881/wp-admin/profile.php, scroll to
                Application Passwords, add one named “Complex Patient”, then sign in with your
                WordPress username (the login name shown at the top of your profile — not your
                email) and that application password.
              </Text>
            )}

          {error && (
            <Text style={styles.error} accessibilityRole="alert" testID="sign-in-error">
              {error}
            </Text>
          )}

          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor="#888"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => passwordRef.current?.focus()}
            accessibilityLabel="Username"
            testID="sign-in-username"
            {...keyboardDoneAccessoryProps()}
          />

          <TextInput
            ref={passwordRef}
            style={styles.input}
            placeholder="Application Password"
            placeholderTextColor="#888"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => {
              void handleSignIn();
            }}
            accessibilityLabel="Application Password"
            testID="sign-in-password"
            {...applicationPasswordAutofillProps()}
            {...keyboardDoneAccessoryProps()}
          />

          <Pressable
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={() => {
              void handleSignIn();
            }}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            testID="sign-in-submit"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 32,
    paddingBottom: 48,
  },
  form: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    alignItems: 'stretch',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
    color: '#1a1a1a',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#555',
    marginBottom: 12,
    textAlign: 'center',
  },
  hint: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 20,
  },
  error: {
    color: '#c00',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 16,
    color: '#1a1a1a',
    backgroundColor: '#fafafa',
  },
  button: {
    width: '100%',
    minHeight: 48,
    backgroundColor: '#0066cc',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 12,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
