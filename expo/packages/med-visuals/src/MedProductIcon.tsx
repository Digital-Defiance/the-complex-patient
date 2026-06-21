import React from 'react';
import { View, StyleSheet } from 'react-native';
import type { MedAppearance } from '@complex-patient/domain';
import { PillIcon, type PillIconProps } from './PillIcon';
import { SprayIcon } from './spray';
import { InjectableIcon } from './injectable';
import { PatchIcon } from './patch';
import { DropIcon } from './drop';
import { GenericMedIcon } from './generic';
import { resolveMedProductKind, hasCustomizableMedAppearance, type MedProductKind } from './product-kind';

export {
  resolveMedProductKind,
  hasCustomizableMedAppearance,
  isSprayMedication,
  isVialMedication,
  isAmpouleMedication,
  isNonPillMedication,
} from './product-kind';
export type { MedProductKind } from './product-kind';

export interface MedProductIconProps extends Omit<PillIconProps, 'appearance'> {
  appearance?: MedAppearance;
  form?: string;
  dosageUnit?: string;
}

export function MedProductIcon({
  appearance,
  form = '',
  dosageUnit = '',
  size = 36,
  presentation = 'health',
  testID,
}: MedProductIconProps): React.ReactElement {
  const kind = resolveMedProductKind(form, dosageUnit);
  const primary = appearance?.colorPrimary ?? '#94a3b8';
  const accent = appearance?.colorSecondary ?? appearance?.colorPrimary ?? '#2563eb';

  if (kind === 'generic') {
    return <GenericMedIcon size={size} testID={testID} />;
  }

  const product = renderProduct(kind, appearance, primary, accent, size, testID);

  if (presentation === 'flat' || kind !== 'pill') {
    return product;
  }

  const wellSize = Math.round(size * 1.65);
  return (
    <View
      style={[styles.well, { width: wellSize, height: wellSize, borderRadius: wellSize / 2 }]}
      testID={testID}
    >
      {product}
    </View>
  );
}

function renderProduct(
  kind: MedProductKind,
  appearance: MedAppearance | undefined,
  primary: string,
  accent: string,
  size: number,
  testID?: string,
): React.ReactElement {
  switch (kind) {
    case 'spray':
      return (
        <SprayIcon
          colorPrimary={primary}
          colorAccent={accent}
          size={size}
          testID={testID ? `${testID}-spray` : undefined}
        />
      );
    case 'vial':
      return (
        <InjectableIcon
          variant="vial"
          colorPrimary={primary}
          colorAccent={accent}
          size={size}
          testID={testID ? `${testID}-vial` : undefined}
        />
      );
    case 'ampoule':
      return (
        <InjectableIcon
          variant="ampoule"
          colorPrimary={primary}
          colorAccent={accent}
          size={size}
          testID={testID ? `${testID}-ampoule` : undefined}
        />
      );
    case 'patch':
      return (
        <PatchIcon
          colorPrimary={primary}
          colorAccent={accent}
          size={size}
          testID={testID ? `${testID}-patch` : undefined}
        />
      );
    case 'drop':
      return (
        <DropIcon
          colorPrimary={primary}
          colorAccent={accent}
          size={size}
          testID={testID ? `${testID}-drop` : undefined}
        />
      );
    case 'pill':
    default:
      return (
        <PillIcon
          appearance={appearance}
          size={size}
          presentation="flat"
          testID={testID ? `${testID}-pill` : undefined}
        />
      );
  }
}

const styles = StyleSheet.create({
  well: {
    backgroundColor: '#e8eaed',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
