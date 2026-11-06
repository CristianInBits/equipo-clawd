# Herramientas del mod Equipo

Esta carpeta guarda los scripts que generan los dibujos y los sonidos del mod, junto con sus fuentes. Nada de lo que hay aquí se carga con el mod: solo sirve para volver a generar `hooks/clawds.ts`, `assets/tintineo.wav`, `assets/victoria.wav` y los dibujos del README, en `imagenes/clawds/`, cuando se quiera cambiarlos.

Hace falta Node.js y nada más, porque los scripts no usan paquetes de npm. Están comprobados con Node 24. Se pueden ejecutar desde cualquier carpeta: sin argumentos, cada script lee sus fuentes de esta carpeta y escribe su resultado en el sitio que le corresponde dentro del repositorio.

## Qué hay en esta carpeta

- `genera_clawds.js`: construye `hooks/clawds.ts`, el módulo con los dibujos del mod, y los dibujos del README, a partir de los SVG elegidos.
- `seleccion-clawd.json`: la lista de dibujos elegidos. Cada entrada es `"<id>": "<nombre>"`, donde `<id>` es el nombre del archivo `clawd-<id>.svg` sin `clawd-` ni `.svg`, y `<nombre>` es el nombre de la profesión que enseña el panel.
- `clawd-descarga/`: los 148 SVG animados de [clawd-pet](https://github.com/abderrahimghazali/clawd-pet), de Abderrahim GHAZALI, con su licencia MIT en `LICENSE.txt`. Se descargaron el 06/11/2026 de la carpeta `public/pets/` de la rama `main` de ese repositorio. El mod usa 35 de ellos; el resto se guarda para poder elegir otros sin volver a descargarlos.
- `clawd-propios/`: los dos dibujos hechos para este mod, el médico (`clawd-medico.svg`) y el científico (`clawd-cientifico.svg`), con el mismo estilo y el mismo `viewBox` que los de clawd-pet.
- `genera_tintineo.js`: sintetiza `assets/tintineo.wav`, el sonido de cuando un agente falla o se para.
- `genera_victoria.js`: sintetiza `assets/victoria.wav`, la fanfarria de cuando un agente termina bien.

## genera_clawds.js: los dibujos

Desde la carpeta del repositorio:

```
node herramientas/genera_clawds.js
```

El script recorre `seleccion-clawd.json` en orden y, para cada entrada, busca `clawd-<id>.svg` primero en `clawd-propios/` y, si no lo encuentra allí, en `clawd-descarga/`. A cada dibujo le quita los comentarios y los retornos de carro, comprueba que no lleve nada que pueda ejecutar código o cargar algo de fuera (`<script>`, `foreignObject`, atributos `on…`, enlaces externos) y, si lo lleva, se para con un error. Después le quita el ancho y el alto, para que los decida el panel, y recorta el `viewBox` de `-15 -25 45 45` a `-6 -9 27 27`, que deja el cuerpo centrado con sitio para sombreros por arriba y objetos a los lados.

Escribe tres cosas:

- `hooks/clawds.ts`, con la lista de profesiones, las tres poses del final y los dibujos.
- Una copia de cada dibujo en `imagenes/clawds/`, como `clawd-<id>.svg`, para el `README.md`. Son los mismos dibujos, ya limpios y recortados, con un ancho y un alto de 96 píxeles para que también se vean al abrirlos sueltos; el `README.md` los muestra al tamaño que dice cada `<img>`. Si en esa carpeta queda el dibujo de una profesión que ya no está en la selección, el script no lo borra: lo nombra al acabar, para que lo borres a mano si el `README.md` ya no lo usa.
- Una página de previa, `clawds-previa.html`, en la carpeta temporal del sistema, con todos los dibujos en una cuadrícula para revisarlos de un vistazo en el navegador.

Al acabar imprime cuántas profesiones hay, cuáles son dibujos propios, el tamaño de `clawds.ts` y dónde ha escrito cada cosa.

Acepta seis argumentos opcionales, en este orden: la carpeta de los dibujos descargados, la de los dibujos propios, el archivo de selección, dónde escribir `clawds.ts`, dónde escribir la previa y en qué carpeta dejar los dibujos del README. Sirven, por ejemplo, para generar una prueba fuera del repositorio sin tocar `hooks/clawds.ts` ni `imagenes/clawds/`, en una carpeta que ya exista (en el ejemplo, `C:\temp`; la carpeta `C:\temp\clawds` la crea el script):

```
node herramientas/genera_clawds.js herramientas/clawd-descarga herramientas/clawd-propios herramientas/seleccion-clawd.json C:\temp\clawds.ts C:\temp\previa.html C:\temp\clawds
```

Cómo cambiar los dibujos:

- Para cambiar el nombre de una profesión, cambia su valor en `seleccion-clawd.json` y vuelve a ejecutar el script.
- Para añadir una profesión de clawd-pet, añade su entrada a `seleccion-clawd.json`. Para ver los 148 dibujos y elegir, se pueden abrir los SVG de `clawd-descarga/` en el navegador, que los enseña animados.
- Para añadir un dibujo propio, guárdalo en `clawd-propios/` como `clawd-<id>.svg`, con `viewBox="-15 -25 45 45"` como los demás, y añade su entrada a la selección. Si un dibujo propio se llama igual que uno descargado, el script usa el propio. Cambia también el comentario de cabecera que escribe el script, porque nombra a `medico` y `cientifico` como los únicos dibujos que no son de clawd-pet.
- Las tres últimas entradas de la selección, `celebrating`, `dizzy` y `sleeping`, no son profesiones sino las poses del final (terminado, fallo y parado). El script las reconoce por su `id`, y su nombre solo aparece en la previa.
- La galería «Las 34 profesiones» del `README.md` está escrita a mano. Si cambias la selección, cambia también esa tabla y el número de su título, y la fila de Clawds del principio del `README.md` si nombra un dibujo que ya no está.

Los dibujos de clawd-pet tienen licencia MIT, que obliga a conservar su aviso de copyright: por eso el repositorio lleva `LICENSE-clawd-pet.txt` en la raíz y `clawd-descarga/LICENSE.txt` aquí. No borres ninguno de los dos.

## genera_tintineo.js y genera_victoria.js: los sonidos

Desde la carpeta del repositorio:

```
node herramientas/genera_tintineo.js
```

```
node herramientas/genera_victoria.js
```

Sin argumentos escriben `assets/tintineo.wav` y `assets/victoria.wav`; con un argumento, escriben en esa ruta, lo que sirve para escuchar una prueba antes de sustituir el sonido del mod. Los dos sonidos se sintetizan desde cero, sin ningún archivo de terceros, como WAV PCM de 16 bits, mono y a 44 100 Hz.

- El tintineo son dos notas de campanilla, mi6 (1318,51 Hz) y si6 (1975,53 Hz), separadas por 85 milisegundos, en medio segundo en total. Para cambiarlo, se tocan la lista `notas` (inicio, frecuencia, volumen y `tau`, que es lo rápido que se apaga cada nota) y `DURACION`.
- La fanfarria son cuatro notas con timbre de metal: sol4, do5 y mi5, de una décima de segundo cada una, y un sol5 sostenido de 0,42 segundos con vibrato, en unos 0,87 segundos en total. Para cambiarla, se tocan la lista `notas` (frecuencia, duración y si lleva vibrato) y `HUECO`, el silencio entre notas.

Para escuchar una prueba en Windows con el mismo reproductor que usa el mod, en PowerShell:

```
(New-Object Media.SoundPlayer 'C:\temp\prueba.wav').PlaySync()
```

## Comprobar que los scripts regeneran lo mismo

Los tres scripts son deterministas: con las mismas fuentes, producen exactamente los mismos bytes. El 06/11/2026 se comprobó, con Node 24, que regeneran `hooks/clawds.ts`, `assets/tintineo.wav` y `assets/victoria.wav` idénticos byte a byte a los de la versión 0.1.0 (commit `34baa88`). Para repetir la comprobación, desde la carpeta del repositorio y sin otros cambios a medias:

```
node herramientas/genera_clawds.js
node herramientas/genera_tintineo.js
node herramientas/genera_victoria.js
git status --short
```

Si `git status` no lista `hooks/clawds.ts`, los dibujos de `imagenes/clawds/` ni los dos WAV, los archivos regenerados son idénticos a los del último commit. El `.gitattributes` del repositorio fija los finales de línea en LF también en Windows, que es lo que escriben los scripts; sin él, git marcaría `hooks/clawds.ts` como cambiado aunque su contenido fuera el mismo.

Después de cambiar un dibujo o un sonido, desde la carpeta del repositorio, comprueba el mod con `claude plugin validate .`, que tiene que terminar con `Validation passed`, y pasa los tests con `claude plugin test .`. Después pruébalo en una sesión con `/reload-plugins` y sube el número de `version` en `.claude-plugin/plugin.json`, porque quien instaló el mod desde GitHub solo recibe los cambios cuando hay una versión nueva.
