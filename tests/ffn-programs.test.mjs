import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { programaFfn } from '../public/js/compartido/ffn-programs.mjs';

describe('programaFfn', () => {
  it('sigue con los programas que ya estaban en la ficha', () => {
    assert.equal(programaFfn('cm'), 'ConnectMiles (Copa Airlines)');
    assert.equal(programaFfn('AA'), 'AAdvantage (American Airlines)');
    assert.equal(programaFfn('LA'), 'LATAM Pass');
    assert.equal(programaFfn('AR'), 'Aerolíneas Plus');
    assert.equal(programaFfn('LH'), 'Miles & More (Lufthansa)');
    assert.equal(programaFfn('AF'), 'Flying Blue (Air France)');
    assert.equal(programaFfn('KL'), 'Flying Blue (KLM)');
  });

  it('Gol es Smiles y Azul es Azul Fidelidade', () => {
    assert.equal(programaFfn('G3'), 'Smiles (Gol)');
    assert.equal(programaFfn('AD'), 'Azul Fidelidade');
  });

  it('nombra el programa de cada aerolínea de la ficha que tiene número de socio', () => {
    const esperados = {
      AU: 'Aerolíneas Plus',
      JJ: 'LATAM Pass',
      LAN: 'LATAM Pass',
      UX: 'SUMA (Air Europa)',
      LX: 'Miles & More (Swiss)',
      OS: 'Miles & More (Austrian)',
      AZ: 'Miles & More (ITA Airways)',
      TP: 'TAP Miles&Go',
      EY: 'Etihad Guest',
      TK: 'Miles&Smiles (Turkish Airlines)',
      AT: 'Safar Flyer (Royal Air Maroc)',
      MS: 'EgyptAir Plus',
      ET: 'ShebaMiles (Ethiopian)',
      SQ: 'KrisFlyer (Singapore Airlines)',
      QF: 'Qantas Frequent Flyer',
      NZ: 'Airpoints (Air New Zealand)',
      CX: 'Asia Miles (Cathay Pacific)',
      KE: 'SKYPASS (Korean Air)',
      OZ: 'Asiana Club',
      NH: 'ANA Mileage Club',
      JL: 'JAL Mileage Bank',
      MU: 'Eastern Miles (China Eastern)',
      DY: 'Norwegian Reward',
      UA: 'MileagePlus (United)',
      IB: 'Iberia Plus',
      BA: 'The British Airways Club',
      AC: 'Aeroplan (Air Canada)',
      AM: 'Club Premier (Aeroméxico)',
      DL: 'SkyMiles (Delta)',
      QR: 'Privilege Club (Qatar Airways)',
      EK: 'Skywards (Emirates)',
      AV: 'LifeMiles (Avianca)'
    };
    for (const [code, nombre] of Object.entries(esperados)) {
      assert.equal(programaFfn(code), nombre, code);
    }
    assert.equal(programaFfn(''), '');
    assert.equal(programaFfn('ZZ'), '');
  });

  it('tambien nombra programas de aerolineas que no son las de siempre', () => {
    const esperados = {
      SK: 'EuroBonus (SAS)',
      B6: 'TrueBlue (JetBlue)',
      WN: 'Rapid Rewards (Southwest)',
      SU: 'Aeroflot Bonus',
      A3: 'Miles+Bonus (Aegean)',
      SV: 'Alfursan (Saudia)',
      FI: 'Saga Club (Icelandair)',
      GA: 'GarudaMiles (Garuda Indonesia)',
      CZ: 'Sky Pearl Club (China Southern)',
      CA: 'PhoenixMiles (Air China)',
      VA: 'Velocity (Virgin Australia)',
      WS: 'WestJet Rewards',
      JA: 'Discount Club (JetSMART)',
      BT: 'airBaltic Club',
      LY: 'Matmid Club (El Al)',
      VN: 'Lotusmiles (Vietnam Airlines)',
      MF: 'Egret Club (XiamenAir)',
      AI: 'Maharaja Club (Air India)',
      '6E': 'BluChip (IndiGo)',
      FJ: 'AAdvantage (Fiji Airways)',
      DE: 'Atmos Rewards (Condor)',
      LP: 'LATAM Pass',
      '2K': 'LifeMiles (Avianca Ecuador)',
      U2: 'Flight Club (easyJet)',
      GF: 'Falconflyer (Gulf Air)'
    };
    for (const [code, nombre] of Object.entries(esperados)) {
      assert.equal(programaFfn(code), nombre, code);
    }
  });
});
