import { render } from 'preact';
import './design/tokens.css';
import './design/base.css';
import './design/components.css';
import './design/screens.css';
import { App } from './app/App';
import { init } from './app/state';
import { setLocale } from './i18n';

setLocale('fr');
render(<App />, document.getElementById('app')!);
init().catch((e) => console.error('Initialisation impossible', e));

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
