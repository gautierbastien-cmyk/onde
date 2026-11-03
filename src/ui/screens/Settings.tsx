/** Réglages. */
import { useEffect, useState } from 'preact/hooks';
import { useSelector } from '../../core/store';
import type { Theme } from '../../core/types';
import { clearHistory, clearRecents, resetAll, setPrefs, store, toast } from '../../app/state';
import { openSheet } from '../../app/nav';
import { Cell, Group, Screen, Segmented, Toggle } from '../components/UI';

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

function StorageInfo() {
  const [info, setInfo] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  useEffect(() => {
    (async () => {
      const est = await navigator.storage?.estimate?.().catch(() => undefined);
      const persisted = await navigator.storage?.persisted?.().catch(() => undefined);
      setInfo({ usage: est?.usage, quota: est?.quota, persisted });
    })();
  }, []);
  const mb = (n?: number) => (n === undefined ? '—' : `${(n / 1024 / 1024).toLocaleString('fr', { maximumFractionDigits: 1 })} Mo`);
  return (
    <>
      <Cell label="Espace utilisé" detail={mb(info.usage)} />
      <Cell label="Protection contre l’effacement" detail={info.persisted === undefined ? '—' : info.persisted ? 'Active' : 'Non accordée'} />
    </>
  );
}

export function Settings() {
  const { prefs, counts } = useSelector(store, (s) => ({
    prefs: s.prefs,
    counts: { stations: s.stations.length, playlists: s.playlists.length, tracks: s.tracks.length, favorites: s.favorites.length },
  }));
  const [relay, setRelay] = useState(prefs.relayUrl);
  const [testing, setTesting] = useState(false);

  const pasteRelay = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!/^https?:\/\//.test(text)) return toast('Le presse-papiers ne contient pas d’adresse');
      setRelay(text);
      await saveRelay(text);
    } catch {
      toast('Collez l’adresse dans le champ (appui long → Coller)');
    }
  };

  const saveRelay = async (value = relay) => {
    const url = value.trim().replace(/\/+$/, '');
    if (url && !/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) return toast('Le relais doit être en HTTPS');
    if (!url) {
      setPrefs({ relayUrl: '', relayStreams: false });
      return toast('Relais désactivé');
    }
    setTesting(true);
    try {
      const res = await fetch(`${url}/health`, { cache: 'no-store' });
      const json = await res.json();
      if (!json.ok) throw new Error();
      setPrefs({ relayUrl: url });
      toast('Relais connecté');
    } catch {
      toast('Relais injoignable : vérifiez l’adresse');
    } finally {
      setTesting(false);
    }
  };

  return (
    <Screen title="Réglages" back>
      <div class="pad">
        <Group title="Apparence">
          <div class="cell">
            <Segmented<Theme>
              value={prefs.theme}
              onChange={(theme) => setPrefs({ theme })}
              options={[
                { value: 'dark', label: 'Sombre' },
                { value: 'light', label: 'Clair' },
                { value: 'auto', label: 'Auto' },
              ]}
            />
          </div>
        </Group>

        <Group
          title="Informations musicales"
          footer="Quand un morceau est connu (annonce de la radio ou Shazam), Onde cherche sa pochette et son album sur Spotify via votre relais, sinon dans le catalogue public d’Apple. Seul un résultat dont l’artiste et le titre correspondent est retenu."
        >
          <Cell icon="note" tint="linear-gradient(135deg,#ff8a4c,#ff3d6e)" label="Pochettes Spotify / Apple Music">
            <Toggle checked={prefs.artworkLookup} onChange={(v) => setPrefs({ artworkLookup: v })} label="Pochettes" />
          </Cell>
        </Group>

        <Group
          title="Relais personnel (facultatif)"
          footer={
            <>
              Le relais active la reconnaissance <strong>Shazam</strong> (identification automatique sur toutes les stations, relancée à chaque nouveau morceau, et bouton dans le lecteur), récupère les titres des serveurs fermés aux navigateurs et lit les flux HTTP. Shazam est utilisé de façon non officielle : il peut cesser de fonctionner sans préavis. Installation : <code>relay/README.md</code> du projet.
            </>
          }
        >
          <div class="cell cell-input">
            <input type="url" inputMode="url" placeholder="https://…/onde/…" value={relay} onInput={(e) => setRelay((e.target as HTMLInputElement).value)} autocomplete="off" autocapitalize="off" spellcheck={false} />
            {relay ? (
              <button class="text-btn" onClick={() => saveRelay()} disabled={testing}>
                {testing ? '…' : 'Valider'}
              </button>
            ) : (
              <button class="text-btn" onClick={pasteRelay} disabled={testing}>
                Coller
              </button>
            )}
          </div>
          {prefs.relayUrl && (
            <Cell label="Shazam automatique">
              <Toggle checked={prefs.autoShazam} onChange={(v) => setPrefs({ autoShazam: v })} label="Shazam automatique" />
            </Cell>
          )}
          {prefs.relayUrl && (
            <Cell label="Lire aussi les flux HTTP via le relais">
              <Toggle checked={prefs.relayStreams} onChange={(v) => setPrefs({ relayStreams: v })} label="Lire les flux HTTP via le relais" />
            </Cell>
          )}
        </Group>

        <Group title="Bibliothèque">
          <Cell label="Stations" detail={counts.stations} />
          <Cell label="Playlists" detail={counts.playlists} />
          <Cell label="Favoris" detail={counts.favorites} />
          <Cell label="Titres dans l’historique" detail={counts.tracks} />
          <StorageInfo />
        </Group>

        <Group title="Installation">
          <Cell icon="share" tint="linear-gradient(135deg,#30b0c7,#0a84ff)" label="Ajouter à l’écran d’accueil" detail={isStandalone() ? 'Installée' : ''} chevron onClick={() => openSheet({ type: 'install' })} />
        </Group>

        <Group title="Données" footer="Tout est stocké uniquement sur cet appareil. Aucun compte, aucun serveur, aucune statistique.">
          <Cell label="Effacer les radios récemment écoutées" danger onClick={() => confirm('Effacer les radios récemment écoutées ?') && clearRecents()} />
          <Cell label="Effacer l’historique musical" danger onClick={() => confirm('Effacer tout l’historique musical ?') && clearHistory()} />
          <Cell label="Tout réinitialiser" danger onClick={() => confirm('Supprimer playlists, stations, favoris, historique et réglages ?') && resetAll()} />
        </Group>

        <Group
          title="CarPlay"
          footer="Lancez une radio sur l’iPhone, puis branchez-le ou connectez-le à la voiture : Onde apparaît dans « À l’écoute » de CarPlay avec le nom de la station, le titre et la pochette. Lecture, pause, suivant et précédent (écran CarPlay, boutons du volant) parcourent vos favoris dans l’ordre choisi. Une app web ne peut pas avoir sa propre icône dans CarPlay : cela exige une app native autorisée par Apple."
        >
          <Cell icon="radio" tint="linear-gradient(135deg,#30d158,#0a84ff)" label="Suivant / précédent = favoris" detail="Actif" />
        </Group>

        <Group title="Limites d’iOS à connaître">
          <div class="prose">
            <p>
              <strong>Lecture en arrière-plan.</strong> La radio continue écran verrouillé et se pilote depuis l’écran de verrouillage, le Centre de contrôle et les AirPods. iOS peut toutefois ralentir l’app : les titres sont alors mis à jour moins souvent.
            </p>
            <p>
              <strong>Volume.</strong> Safari interdit aux sites de régler le volume : utilisez les boutons de l’iPhone.
            </p>
            <p>
              <strong>Visualisation audio.</strong> Analyser le son demande de faire passer le flux par la Web Audio API, ce qui coupe le son des radios sans CORS et casse la lecture écran verrouillé. Onde affiche donc l’état de lecture, sans faux spectre.
            </p>
            <p>
              <strong>Reconnaissance type Shazam.</strong> ShazamKit est réservé aux apps natives. Onde est prête à accueillir un moteur de reconnaissance audio (architecture <code>MusicRecognitionService</code>), sans service payant imposé.
            </p>
          </div>
        </Group>
        <p class="footnote center">Onde · usage personnel · version {__APP_VERSION__}</p>
      </div>
    </Screen>
  );
}
