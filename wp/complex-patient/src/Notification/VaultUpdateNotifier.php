<?php

declare(strict_types=1);

namespace ComplexPatient\Notification;

/**
 * Notifies other devices when a vault partition is successfully updated.
 *
 * Implementations must send only non-PHI hints (vault_type, sync_version).
 */
interface VaultUpdateNotifier
{
  public function notifyVaultUpdated(
    int $userId,
    string $vaultType,
    int $syncVersion,
    ?string $originatingDeviceId
  ): void;
}
