export function groupByPassenger(results) {
  const groups = []; // cada grupo es el objeto pasajero final

  for (const { mapped, filename } of results) {
    const pnum = (mapped.parg?.num || mapped.pext?.num || '').toUpperCase().trim();
    const nameKey = `${mapped.lastname || ''}|${mapped.firstname || ''}|${mapped.dob || ''}`;

    // Buscar grupo existente por número de pasaporte o por nombre+fecha
    let group = null;
    if (pnum) {
      group = groups.find(g => {
        const gp = (g.parg?.num || g.pext?.num || '').toUpperCase().trim();
        return gp && gp === pnum;
      });
    }
    if (!group && nameKey !== '||') {
      group = groups.find(g => {
        const gk = `${g.lastname || ''}|${g.firstname || ''}|${g.dob || ''}`;
        return gk === nameKey;
      });
    }

    if (!group) {
      // Nuevo pasajero
      group = { ...mapped, _files: [filename] };
      groups.push(group);
    } else {
      // Fusionar: completar campos vacíos y agregar visa si es nueva
      group._files.push(filename);
      const fill = (key, sub) => {
        if (sub) {
          if (!group[key]) { group[key] = mapped[key]; return; }
          // Fusionar subcampos (ej: parg, visa1)
          for (const [k, v] of Object.entries(mapped[key] || {})) {
            if (v && !group[key][k]) group[key][k] = v;
          }
        } else {
          if (!group[key] && mapped[key]) group[key] = mapped[key];
        }
      };
      fill('lastname'); fill('firstname'); fill('dob'); fill('gender'); fill('nationality');
      fill('dni', true); fill('parg', true); fill('pext', true);
    }
    // El primer documento tambien debe usar el formato que guarda el import.
    if (mapped.visa) {
      if (!group.visa1?.num) group.visa1 = mapped.visa;
      else if (!group.visa2?.num) group.visa2 = mapped.visa;
    }
    if (mapped.asistencia) {
      if (!group.asistencias) group.asistencias = [];
      group.asistencias.push(mapped.asistencia);
    }
  }
  return groups;
}
