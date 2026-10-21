# App Gym

Tu registro de entrenamientos: una app web que se instala en el iPhone (ícono en la pantalla de inicio, pantalla completa, funciona sin internet) y respalda todo en tu Google Sheets.

## Cómo funciona

- **Hoy**: te sugiere la rutina del día (lunes/jueves pecho-hombro-tríceps, etc.). Tocas *Empezar*.
- **Entrenando**: cada ejercicio muestra *Última vez* y cada serie trae en gris lo que hiciste la vez pasada. Si repetiste, solo palomeas ✓; si cambió, escribes encima. Al palomear arranca el descanso (3:00 por defecto).
- **Variantes**: los lugares con dos opciones (Banca / Converging) se cambian con un toque, y cada una guarda su propio historial.
- **Nota del día** (⋯ → *Nota del día*): por ejemplo “Unilateral”. La próxima vez verás *Última vez (Unilateral)*.
- **Serie con “/”** (toca el número de la serie): agrega una segunda parte, por ejemplo juntos y luego unilateral.
- **Historial**: cada entrenamiento se puede ver en detalle o *Como en mis notas* (tu tabla de siempre).
- **Ejercicios**: notas permanentes (ajustes de máquina, técnica), récord, gráfica de progreso, unir duplicados.
- **Respaldo**: los datos viven en el iPhone y se suben solos a Google Sheets cuando hay internet. En *Más* también puedes exportar un archivo.

## Lo que falta configurar (una sola vez)

1. **Google Sheets**: sigue [apps-script/INSTRUCCIONES.md](apps-script/INSTRUCCIONES.md) (unos 5 minutos). Al final tendrás una URL y un token.
2. **Instalar en el iPhone**: abre **https://danielorug.github.io/app-gym/** en **Safari** → botón Compartir → *Agregar a inicio*.
3. En la app: **Más → Respaldo en Google Sheets** → pega URL y token → *Conectar*. Si ya subiste tu historial a la hoja, aquí se descarga.

## Importar tu historial de Notas

Lee la nota “23 Julio 2026” directamente de la app Notas de tu Mac:

```bash
npm run importar
```

Genera `importado/historial.json` y `importado/reporte.md` (qué se importó y qué conviene revisar). Para subirlo a tu hoja de Google:

```bash
npx tsx scripts/subir-a-sheets.ts --url "TU_URL" --token "TU_TOKEN"
```

Se puede volver a correr sin duplicar nada. Lo que corrijas en la app tiene prioridad. Lo que el importador no supo leer con seguridad aparece en la app en **Más → Revisar importados**.

## Publicar (GitHub Pages)

La app vive en **https://danielorug.github.io/app-gym/** (repositorio público `danielorug/app-gym`; solo código, tus datos de `importado/` están excluidos en `.gitignore` y viven en tu Google Sheets).

Para publicar una versión nueva desde la Mac:

```bash
npm run publicar
```

Corre las pruebas, construye la app y la sube a la rama `gh-pages`. El iPhone toma la versión nueva solo, la siguiente vez que abras la app con internet.

## Para desarrollar

```bash
npm install
npm run dev
npm test
npm run build
```

- `src/db`: modelo de datos y base local (IndexedDB con Dexie).
- `src/lib`: consultas, acciones y formato (tu notación, récords).
- `src/ui`: pantallas.
- `src/sync` + `apps-script/Code.gs`: sincronización con Google Sheets.
- `src/import` + `scripts/importar-notas.ts`: importador de Notas.
