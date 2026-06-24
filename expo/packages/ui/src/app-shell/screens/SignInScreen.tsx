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
} from 'react-native';
import { useAppHost } from '../app-host';
import type { WordPressAuth } from '../../app';
import {
  IosKeyboardDoneAccessory,
  keyboardDoneAccessoryProps,
} from '../ios-keyboard-done-accessory';

export function SignInScreen(): React.ReactElement {
  const { home, refreshHomeStatus } = useAppHost();
  const passwordRef = useRef<TextInput>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignIn = useCallback(async () => {
    if (!home) return;

    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

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
          setError(
            'WordPress rejected those credentials. Use an Application Password from your WordPress user profile — not your regular login password.',
          );
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
            Sign in with your WordPress username and an Application Password (Users → Profile → Application Passwords).
          </Text>

          {error && (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          )}

          <TextInput
            style={styles.input}
            placeholder="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
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
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            returnKeyType="done"
            onSubmitEditing={() => {
              void handleSignIn();
            }}
            accessibilityLabel="Application Password"
            testID="sign-in-password"
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
    marginBottom: 24,
    textAlign: 'center',
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
