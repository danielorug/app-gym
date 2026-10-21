import { relativeDays, toISO } from '../lib/dates';
import { syncNow, useSyncStatus } from '../sync/sync';
import { navigate } from './router';

export function SyncPill() {
  const status = useSyncStatus();
  if (status.state === 'off') {
    return (
      <button className="sync-pill" onClick={() => navigate('mas')}>
        <span className="dot warn" /> Sin respaldo
      </button>
    );
  }
  const label =
    status.state === 'syncing'
      ? 'Guardando…'
      : status.state === 'offline'
        ? status.pending > 0
          ? `${status.pending} sin subir`
          : 'Sin internet'
        : status.state === 'error'
          ? 'Error al guardar'
          : status.pending > 0
            ? `${status.pending} sin subir`
            : 'Respaldado';
  const dot = status.state === 'syncing' ? 'busy' : status.state === 'error' ? 'err' : status.state === 'offline' || status.pending > 0 ? 'warn' : 'ok';
  return (
    <button className="sync-pill" onClick={() => (status.state === 'error' ? navigate('mas') : void syncNow())} title={status.lastSyncAt ? `Último respaldo ${relativeDays(toISO(new Date(status.lastSyncAt)))}` : undefined}>
      <span className={`dot ${dot}`} /> {label}
    </button>
  );
}
