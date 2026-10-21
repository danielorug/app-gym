import { useEffect, useRef, useState } from 'react';
import { exportBackup, importBackup } from '../../db/db';
import type { Backup } from '../../db/types';
import { useReviewEntries } from '../../lib/data';
import { formatClock, todayISO } from '../../lib/dates';
import { getSyncConfig, setSyncConfig, syncNow, testConnection, useSyncStatus } from '../../sync/sync';
import { Topbar, toast } from '../components';
import { IconChevronRight } from '../icons';
import { setPrefs, usePrefs } from '../prefs';
import { navigate } from '../router';

const REST_OPTIONS = [90, 120, 150, 180, 210, 240];

export function MoreScreen() {
  const prefs = usePrefs();
  const review = useReviewEntries();
  return (
    <>
      <Topbar title="Más" />
      <div className="page">
        <div className="list">
          <button className="list-item" onClick={() => navigate('rutinas')}>
            <div className="grow">
              <div className="title">Rutinas</div>
              <div className="meta">Días, orden, variantes y opcionales</div>
            </div>
            <IconChevronRight className="chevron" />
          </button>
          <button className="list-item" onClick={() => navigate('revisar')}>
            <div className="grow">
              <div className="title">Revisar importados</div>
              <div className="meta">{review?.length ? `${review.length} pendientes` : 'Nada pendiente'}</div>
            </div>
            <IconChevronRight className="chevron" />
          </button>
        </div>

        <SheetsSection />

        <div className="section-title">Descanso entre series</div>
        <div className="card">
          <div className="row wrap">
            {REST_OPTIONS.map((s) => (
              <button key={s} className={`chip${prefs.restSeconds === s ? ' active' : ''}`} onClick={() => setPrefs({ restSeconds: s })}>
                {formatClock(s)}
              </button>
            ))}
          </div>
          <Toggle label="Sonido al terminar el descanso" checked={prefs.restSound} onChange={(restSound) => setPrefs({ restSound })} />
          <Toggle label="Mantener la pantalla encendida mientras entreno" checked={prefs.keepAwake} onChange={(keepAwake) => setPrefs({ keepAwake })} />
        </div>

        <BackupSection />

        <p className="faint tiny" style={{ textAlign: 'center', marginTop: 28 }}>
          App Gym · tus datos se guardan en este dispositivo y en tu Google Sheets
        </p>
      </div>
    </>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row" style={{ marginTop: 14, minHeight: 32 }}>
      <span style={{ flex: 1 }}>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--accent)' }} />
    </label>
  );
}

function SheetsSection() {
  const status = useSyncStatus();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void getSyncConfig().then((cfg) => {
      if (cfg) {
        setUrl(cfg.url);
        setToken(cfg.token);
        setConfigured(true);
      }
    });
  }, []);

  const connect = async () => {
    setBusy(true);
    setMessage(null);
    const cfg = { url: url.trim(), token: token.trim() };
    const res = await testConnection(cfg);
    if (res.ok) {
      await setSyncConfig(cfg);
      setConfigured(true);
      const s = await syncNow();
      setMessage(s.ok ? { ok: true, text: `Conectado. Subí ${s.pushed} y bajé ${s.pulled} registros.` } : { ok: false, text: s.error ?? 'No se pudo sincronizar' });
    } else {
      setMessage({ ok: false, text: res.error ?? 'No se pudo conectar' });
    }
    setBusy(false);
  };

  return (
    <>
      <div className="section-title">Respaldo en Google Sheets</div>
      <div className="card">
        {configured ? (
          <>
            <div className="row">
              <span className={`dot ${status.state === 'error' ? 'err' : status.state === 'syncing' ? 'busy' : status.pending ? 'warn' : 'ok'}`} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {status.state === 'error' ? 'Hubo un error' : status.state === 'offline' ? 'Sin internet' : status.state === 'syncing' ? 'Sincronizando…' : 'Conectado'}
                </div>
                <div className="muted small">
                  {status.error ??
                    (status.pending
                      ? `${status.pending} cambios esperando subir`
                      : status.lastSyncAt
                        ? `Último respaldo: ${new Date(status.lastSyncAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`
                        : 'Todo al día')}
                </div>
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="btn small primary"
                disabled={status.state === 'syncing'}
                onClick={async () => {
                  const r = await syncNow();
                  toast(r.ok ? `Sincronizado (↑${r.pushed} ↓${r.pulled})` : (r.error ?? 'Error'));
                }}
              >
                Sincronizar ahora
              </button>
              <span className="spacer" />
              <button
                className="btn small danger"
                onClick={async () => {
                  await setSyncConfig(null);
                  setConfigured(false);
                  setMessage(null);
                }}
              >
                Desconectar
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>
              Conecta tu hoja de Google para que nada se pierda. Necesitas la dirección (URL) de tu Apps Script y su clave (token).
            </p>
            <label className="field">
              <span>URL de la aplicación web</span>
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" autoCapitalize="off" autoCorrect="off" />
            </label>
            <label className="field">
              <span>Token</span>
              <input className="input" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Clave que te dio “configurar”" autoCapitalize="off" autoCorrect="off" />
            </label>
            <button className="btn primary block" disabled={busy || !url.trim() || !token.trim()} onClick={connect}>
              {busy ? 'Conectando…' : 'Conectar'}
            </button>
          </>
        )}
        {message && (
          <div className="small" style={{ marginTop: 10, color: message.ok ? 'var(--good)' : 'var(--bad)' }}>
            {message.text}
          </div>
        )}
      </div>
    </>
  );
}

function BackupSection() {
  const fileRef = useRef<HTMLInputElement>(null);

  const exportFile = async () => {
    const data = await exportBackup();
    const name = `app-gym-respaldo-${todayISO()}.json`;
    const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Backup;
      const n = await importBackup(data, { markDirty: true });
      toast(n ? `Importados ${n} registros` : 'No había nada nuevo');
      void syncNow();
    } catch (e) {
      toast(`No se pudo importar: ${(e as Error).message}`, 4000);
    }
  };

  return (
    <>
      <div className="section-title">Archivo de respaldo</div>
      <div className="card">
        <p className="muted small" style={{ marginTop: 0 }}>
          Exporta todo a un archivo (por si acaso) o importa un respaldo o tu historial de Notas.
        </p>
        <div className="row">
          <button className="btn" style={{ flex: 1 }} onClick={exportFile}>
            Exportar
          </button>
          <button className="btn" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
            Importar archivo
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </>
  );
}
