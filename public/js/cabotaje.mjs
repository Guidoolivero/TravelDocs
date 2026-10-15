// Aeropuertos de Argentina, sacados de js/iata-iso2.mjs.
// El test de cabotaje falla si el mapa suma o saca uno.

const IATA_AR = new Set('AEP,AFA,AOL,APZ,ARR,BHI,BRC,CLX,CNQ,CNT,COC,COR,CPC,CPG,CRD,CRR,CSZ,CTC,CUT,CVH,CVI,EHL,ELO,EMX,EPA,EQS,EZE,FMA,FTE,GGS,GHU,GNR,GPO,HOS,IGB,IGR,IRJ,JSM,JUJ,LCM,LCP,LGS,LHS,LLS,LMD,LPG,LUQ,MCS,MDQ,MDX,MDZ,MJR,MQD,NCJ,NEC,NQN,OES,OLN,ORA,OVR,OYA,OYO,PEH,PMQ,PMY,PRA,PRQ,PSS,PUD,QRF,RAF,RCQ,RCU,RDS,REL,RES,RGA,RGL,RHD,RLO,ROS,ROY,RSA,RYO,RZA,SDE,SFN,SGV,SLA,SST,TDL,TTG,TUC,UAQ,ULA,USH,UZU,VCF,VDM,VDR,VGS,VLG,VME'.split(','));

function codigos(piernas) {
  const out = [];
  for (const p of piernas || []) {
    const raws = [p?.origen, p?.destino, ...(Array.isArray(p?.escalas) ? p.escalas : [])];
    for (const raw of raws) {
      const iata = String(raw || '').trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(iata)) out.push(iata);
    }
  }
  return out;
}

export function esCabotaje(piernas) {
  const codes = codigos(piernas);
  return codes.length > 0 && codes.every(c => IATA_AR.has(c));
}

// Nacionalidad distinta de ARG gana, aunque haya DNI.
// Vacia: alcanza DNI argentino o pasaporte argentino.
export function esArgentino(p) {
  const nac = String(p?.nationality || '').trim().toUpperCase();
  if (nac && nac !== 'ARG') return false;
  if (nac === 'ARG') return true;
  const dniPais = String(p?.dni?.country || '').trim().toUpperCase();
  if (p?.dni?.num && (!dniPais || dniPais === 'ARG')) return true;
  if (p?.parg?.num) return true;
  return false;
}

export function alcanzaConDni(piernas, pasajeros) {
  const lista = pasajeros || [];
  return esCabotaje(piernas) && lista.length > 0 && lista.every(esArgentino);
}
