# Conectar App Gym con Google Sheets

Esto se hace **una sola vez** y toma unos 10 minutos. Al final tendrás una hoja de cálculo en tu Google Drive donde se guarda cada serie que anotes en la app.

La app funciona sin internet: guarda todo en el teléfono y lo sube a la hoja cuando hay señal.

---

## 1. Crear la hoja

1. Abre **Google Drive** en la compu → **Nuevo** → **Hojas de cálculo de Google** (o entra a `sheets.new`).
2. Arriba a la izquierda, donde dice *Hoja de cálculo sin título*, ponle **App Gym**.

## 2. Pegar el código

1. En la hoja, menú **Extensiones** → **Apps Script**. Se abre el editor en otra pestaña.
2. Arriba a la izquierda, donde dice *Proyecto sin título*, ponle **App Gym**.
3. En el archivo **Código.gs** borra lo que hay (`function myFunction() { }`).
4. Abre el archivo `apps-script/Code.gs` de este proyecto, copia **todo** y pégalo ahí.
5. Guarda con el ícono del disco 💾 (o `Cmd + S`).

## 3. Correr "configurar" (crea las pestañas y tu token)

1. En la barra de arriba del editor hay un menú con nombres de funciones. Elige **configurar**.
2. Presiona **▶ Ejecutar**.
3. Google pide permiso la primera vez:
   - **Revisar permisos** → elige tu cuenta.
   - Sale *"Google no verificó esta app"*. Es normal: es tu propio código, no una app publicada por una empresa. Da clic en **Configuración avanzada** (o **Avanzado**) → **Ir a App Gym (no seguro)** → **Permitir**.
   - Los permisos son para que el código pueda leer y escribir en **esta** hoja.
4. Abajo se abre el **Registro de ejecución** con un texto así:

   ```
   Token para la app (cópialo en Más → Respaldo en Google Sheets):
   3f9a…  (40 letras y números)
   ```

   **Copia ese token.** Si se te pierde: recarga la pestaña de la hoja y usa el menú nuevo **App Gym → Configurar / ver token**.

Si regresas a la hoja vas a ver las pestañas nuevas: **Resumen, Ejercicios, Rutinas, RutinaLugares, Sesiones, EjerciciosSesion, Series**.

## 4. Publicarlo como "aplicación web"

1. En el editor, botón azul **Implementar** (arriba a la derecha) → **Nueva implementación**.
2. Junto a *Seleccionar tipo*, da clic en el engrane ⚙️ → **Aplicación web**.
3. Llena así:
   - **Descripción:** App Gym
   - **Ejecutar como:** Yo (tu correo)
   - **Quién tiene acceso:** **Cualquier persona**
4. **Implementar**. (Si vuelve a pedir permisos, acéptalos igual que en el paso 3.)
5. Copia la **URL de la aplicación web**. Termina en **`/exec`**.

> **¿Por qué "Cualquier persona"?** La app se conecta sin iniciar sesión en Google, y con esa opción Google deja pasar la conexión. Lo que protege tus datos es el **token**: sin él, el código contesta "token incorrecto" y no enseña ni cambia nada. No compartas el token. Si crees que alguien lo tiene, usa **App Gym → Generar token nuevo** en la hoja y pega el nuevo en la app.

## 5. Pegarlo en la app

En la app: **Más → Respaldo en Google Sheets** → pega la **URL** y el **token** → **Conectar**. La app prueba la conexión, la guarda y hace la primera sincronización.

Listo. La app sincroniza sola: al abrirla, al regresar a ella, unos segundos después de cada cambio y cada 5 minutos.

## 6. (Una vez) Subir tu historial de Notas

Si ya importamos tu historial en la Mac, súbelo directo a la hoja desde la carpeta del proyecto:

```bash
npx tsx scripts/subir-a-sheets.ts --url "PEGA_LA_URL" --token "PEGA_EL_TOKEN"
```

Después, el teléfono lo baja solo en su primera sincronización. Se puede correr otra vez sin duplicar nada.

---

## Qué hay en la hoja

| Pestaña | Qué guarda |
|---|---|
| **Resumen** | Todas tus series, la más reciente primero. Solo para leer (se arma sola). |
| **Series** | Cada serie: fecha, ejercicio, peso, unidad, reps… |
| **EjerciciosSesion** | Qué ejercicios hiciste en cada sesión y en qué orden. |
| **Sesiones** | Cada entrenamiento (fecha y nombre). |
| **Ejercicios** | Tu catálogo de ejercicios con sus notas (ajustes de máquina, técnica). |
| **Rutinas** / **RutinaLugares** | Tus días de rutina y los ejercicios (con variantes) de cada uno. |

Columnas que conviene conocer en **Series**:

- `load`: `normal` (peso de la máquina o de cada mancuerna), `lado` (discos por lado + barra; `weight` = 25 significa 2×25), `corporal` (peso corporal; un `weight` negativo es ayuda de la máquina).
- `weight2` / `reps2`: la segunda parte de una serie con "/" (juntos y luego unilateral).

### Si corriges algo a mano

- Puedes cambiar un valor (peso, reps, notas…). La app lo recibe en su siguiente sincronización.
- Para **borrar** algo, pon `1` en la columna `deleted`. **No borres la fila**, porque la app no se entera.
- No cambies los nombres de las pestañas, los encabezados ni la columna `id`.

## Si te paso una versión nueva de Code.gs

1. Pega el código nuevo en el editor y guarda.
2. **Implementar → Administrar implementaciones** → lápiz ✏️ (editar) → en **Versión** elige **Nueva versión** → **Implementar**.

Así la URL **no cambia**. (Si usas "Nueva implementación" se crea otra URL y tendrías que pegarla otra vez en la app.)

## Problemas comunes

| La app dice | Qué hacer |
|---|---|
| **Token incorrecto** | Copia el token otra vez (**App Gym → Configurar / ver token**). |
| **La URL no responde como App Gym** o **No se pudo conectar** | Revisa que la URL termine en `/exec` (no `/dev`) y que el acceso sea **Cualquier persona**. |
| **Falta correr "configurar"** | Haz el paso 3. |
| **Sin conexión** | Normal en el gym. Todo queda guardado en el teléfono y se sube cuando haya señal. |
