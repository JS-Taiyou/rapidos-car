# Avisos de terceros — Third-Party Notices

El código propio de este proyecto está bajo **Apache License 2.0** (ver
[LICENSE](LICENSE)). Este archivo reconoce el software de terceros del que
depende, con sus licencias. Las dependencias transitivas conservan sus
propios avisos dentro de `node_modules` y quedan registradas en
`package-lock.json`.

Cubre las dependencias **directas** (`dependencies` + `devDependencies`).

## Índice por licencia

### MIT

| Paquete | Proyecto |
|---|---|
| `astro`, `@astrojs/check`, `@astrojs/node`, `@astrojs/react` | https://github.com/withastro/astro |
| `@hookform/resolvers` | https://github.com/react-hook-form/resolvers |
| `@radix-ui/react-dialog`, `@radix-ui/react-label`, `@radix-ui/react-popover`, `@radix-ui/react-select`, `@radix-ui/react-slot` | https://github.com/radix-ui/primitives |
| `@tailwindcss/vite` | https://github.com/tailwindlabs/tailwindcss |
| `@types/leaflet`, `@types/node`, `@types/react`, `@types/react-dom` | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `clsx` | https://github.com/lukeed/clsx |
| `date-fns` | https://github.com/date-fns/date-fns |
| `driver.js` | https://github.com/nilbuild/driver.js |
| `exceljs` | https://github.com/exceljs/exceljs |
| `jose` | https://github.com/panva/jose |
| `react`, `react-dom` | https://github.com/reactjs/react |
| `react-day-picker` | https://github.com/gpbl/react-day-picker |
| `react-hook-form` | https://github.com/react-hook-form/react-hook-form |
| `sonner` | https://github.com/emilkowalski/sonner |
| `tailwind-merge` | https://github.com/dcastil/tailwind-merge |
| `tsx` | https://github.com/privatenumber/tsx |
| `vitest` | https://github.com/vitest-dev/vitest |
| `zod` | https://github.com/colinhacks/zod |

El CSS de `driver.js` está vendoreado en `src/styles/driver.css` (el paquete
no lo exporta); su aviso de copyright se conserva al inicio del archivo.

### Apache-2.0

| Paquete | Proyecto |
|---|---|
| `@electric-sql/pglite`, `@electric-sql/pglite-socket` | https://github.com/electric-sql/pglite |
| `class-variance-authority` | https://github.com/joe-bell/cva |
| `sharp` | https://github.com/lovell/sharp |
| `typescript` | https://github.com/microsoft/TypeScript |

Texto idéntico al de [LICENSE](LICENSE).

### ISC

| Paquete | Proyecto |
|---|---|
| `lucide-react` | https://github.com/lucide-icons/lucide |

### BSD-2-Clause

| Paquete | Proyecto |
|---|---|
| `leaflet` | https://github.com/Leaflet/Leaflet |

### Unlicense (dominio público)

| Paquete | Proyecto |
|---|---|
| `postgres` | https://github.com/porsager/postgres |

### PostgreSQL License (embebido)

`@electric-sql/pglite` compila y distribuye **PostgreSQL** (WASM) dentro de
su artefacto. PostgreSQL se distribuye bajo la PostgreSQL License, una
licencia permisiva estilo BSD de The PostgreSQL Global Development Group:
https://www.postgresql.org/about/licence/

---

## Textos de las licencias

### MIT

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### ISC

```
Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### BSD-2-Clause

```
Copyright (c) 2010-2023, Volodymyr Agafonkin
Copyright (c) 2010-2011, CloudMade
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### Unlicense

```
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>
```

### PostgreSQL License

```
PostgreSQL Database Management System
(formerly known as Postgres, then as Postgres95)

Portions Copyright (c) 1996-2025, The PostgreSQL Global Development Group

Portions Copyright (c) 1994, The Regents of the University of California

Permission to use, copy, modify, and distribute this software and its
documentation for any purpose, without fee, and without a written agreement
is hereby granted, provided that the above copyright notice and this
paragraph and the following two paragraphs appear in all copies.

IN NO EVENT SHALL THE UNIVERSITY OF CALIFORNIA BE LIABLE TO ANY PARTY FOR
DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, INCLUDING
LOST PROFITS, ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS DOCUMENTATION,
EVEN IF THE UNIVERSITY OF CALIFORNIA HAS BEEN ADVISED OF THE POSSIBILITY OF
SUCH DAMAGE.

THE UNIVERSITY OF CALIFORNIA SPECIFICALLY DISCLAIMS ANY WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS FOR A PARTICULAR PURPOSE. THE SOFTWARE PROVIDED HEREUNDER IS
ON AN "AS IS" BASIS, AND THE UNIVERSITY OF CALIFORNIA HAS NO OBLIGATIONS TO
PROVIDE MAINTENANCE, SUPPORT, UPDATES, ENHANCEMENTS, OR MODIFICATIONS.
```
