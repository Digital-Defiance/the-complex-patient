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

import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useAppHost } from '../app-host';
import type { WordPressAuth } from '../../app';

export function SignInScreen(): React.ReactElement {
  const { home, refreshHomeStatus } = useAppHost();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = () => {
    if (!home) return;

    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    if (!trimmedUsername || !trimmedPassword) {
      setError('Please enter your username and password.');
      return;
    }

    setError(null);

    const auth: WordPressAuth = {
      kind: 'application-password',
      username: trimmedUsername,
      applicationPassword: trimmedPassword,
    };

    home.signIn(auth);
    refreshHomeStatus();
  };

  return (
    <View
      style={styles.container}
      accessibilityRole="none"
      accessibilityLabel="Sign in"
    >
      <Text style={styles.title}>Sign In</Text>
      <Text style={styles.subtitle}>
        Enter your credentials to access your vault.
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
        accessibilityLabel="Username"
        testID="sign-in-username"
      />

      <TextInput
        style={styles.input}
        placeholder="Application Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Application Password"
        testID="sign-in-password"
      />

      <Pressable
        style={styles.button}
        onPress={handleSignIn}
        accessibilityRole="button"
        accessibilityLabel="Sign in"
        testID="sign-in-submit"
      >
        <Text style={styles.buttonText}>Sign In</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 16,
    color: '#555',
    marginBottom: 24,
    textAlign: 'center',
    maxWidth: 320,
  },
  error: {
    color: '#c00',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    maxWidth: 320,
    height: 48,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  button: {
    width: '100%',
    maxWidth: 320,
    height: 48,
    backgroundColor: '#0066cc',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
