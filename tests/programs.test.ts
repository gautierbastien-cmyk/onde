import { describe, expect, it } from 'vitest';
import { currentProgramme, parseXmltv, parseXmltvDate } from '../src/services/programs/xmltv';

const xml = `<?xml version="1.0"?><tv>
  <programme start="20261103000000 +0100" stop="20261104000000 +0100" channel="rmc.fr"><title lang="fr">RMC – En direct</title></programme>
  <programme start="20261103180000 +0100" stop="20261103200000 +0100" channel="nts1.fr"><title lang="fr">Charlie Bones &amp; Friends</title><desc>Live from London</desc></programme>
  <programme start="20261103200000 +0100" stop="20261103220000 +0100" channel="nts1.fr"><title>Late show</title></programme>
</tv>`;

describe('XMLTV', () => {
  it('convertit les dates avec fuseau', () => {
    expect(new Date(parseXmltvDate('20261103180000 +0100')).toISOString()).toBe('2026-11-03T17:00:00.000Z');
    expect(new Date(parseXmltvDate('20261103180000 -0500')).toISOString()).toBe('2026-11-03T23:00:00.000Z');
  });
  it('garde les vraies émissions et ignore les blocs « En direct »', () => {
    const now = parseXmltvDate('20261103190000 +0100');
    const g = parseXmltv(xml, now);
    expect(g['rmc.fr']).toBeUndefined();
    expect(currentProgramme(g['nts1.fr'], now)).toMatchObject({ title: 'Charlie Bones & Friends', desc: 'Live from London' });
    expect(currentProgramme(g['nts1.fr'], parseXmltvDate('20261103210000 +0100'))?.title).toBe('Late show');
  });
});
