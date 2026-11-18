import React, { useEffect } from 'react';
import { Image, View, StyleSheet } from 'react-native';
import heroLogo from '../assets/vorldx-hero-logo.webp';
import { useRouter } from 'expo-router';
import { ArrowRight } from 'lucide-react-native';
import { useAuth } from '../src/context/AuthContext';
import {
  Screen,
  Button,
  Text,
  DashboardSkeleton,
} from '../src/components';
import { brandColors, colors, spacing } from '../src/theme/tokens';
import { useResponsive } from '../src/lib/responsive';

export default function WelcomeScreen() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { isWide } = useResponsive();

  useEffect(() => {
    if (!isLoading && isAuthenticated && user) {
      router.replace('/(tabs)/home');
    }
  }, [isAuthenticated, isLoading, user, router]);

  if (isLoading) {
    return (
      <Screen>
        <DashboardSkeleton />
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']} contentContainerStyle={styles.screenInner}>
      <View style={[styles.container, isWide && styles.containerWide]}>
        {/* Original VORLDX company logo */}
        <View style={styles.globeSection}>
          <Image
            source={heroLogo}
            style={[styles.heroLogo, { width: isWide ? 260 : 220, height: isWide ? 260 : 220 }]}
            resizeMode="contain"
            accessible
            accessibilityLabel="VORLDX Industries Private Limited logo"
          />
        </View>

        <Text variant="subheading" color={colors.textSecondary} align="center" style={styles.description}>
          Attendance Management System
        </Text>

        {/* Action Buttons */}
        <View style={styles.actionSection}>
          <Button
            label="Log In to Account"
            onPress={() => router.push('/login')}
            variant="primary"
            size="lg"
            fullWidth={false}
            gradientColors={[brandColors.oceanBlue, brandColors.oceanBlue]}
            style={[styles.welcomeButton, styles.loginButton]}
            testID="btn-login"
            rightIcon={<ArrowRight size={17} color={colors.white} strokeWidth={2.2} />}
          />

          <Button
            label="Activate New Account"
            onPress={() => router.push('/register')}
            variant="secondary"
            size="lg"
            fullWidth={false}
            style={[styles.welcomeButton, styles.activateButton]}
            testID="btn-register"
          />
        </View>
        <Text variant="caption" color={colors.muted} align="center" style={styles.footer}>
          © 2026 VORLDX INDUSTRIES PRIVATE LIMITED. All rights reserved.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  containerWide: {
    maxWidth: 540,
  },
  description: {
    textAlign: 'center',
    marginTop: -spacing.lg,
  },
  globeSection: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  heroLogo: {
    maxWidth: '100%',
  },
  actionSection: {
    width: '100%',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  welcomeButton: {
    width: '100%',
    maxWidth: 280,
    height: 55,
    borderRadius: 13,
  },
  loginButton: {
    shadowColor: brandColors.oceanBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 9,
    elevation: 4,
  },
  activateButton: {
    backgroundColor: 'rgba(20, 37, 56, 0.35)',
    borderColor: brandColors.oceanBlue,
  },
  footer: {
    width: '100%',
    marginTop: spacing.md,
    lineHeight: 16,
    textTransform: 'none',
    letterSpacing: 0,
  },
});
