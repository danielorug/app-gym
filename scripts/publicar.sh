#!/bin/sh
# Construye la app y la publica en GitHub Pages (rama gh-pages).
# Uso: npm run publicar
set -e
cd "$(dirname "$0")/.."
REMOTE=$(git remote get-url origin)
NAME=$(git config user.name)
EMAIL=$(git config user.email)

npm test
npm run build
touch dist/.nojekyll

cd dist
rm -rf .git
git init -q -b gh-pages
git config user.name "$NAME"
git config user.email "$EMAIL"
git add -A
git commit -q -m "Publicar $(date '+%Y-%m-%d %H:%M')"
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push -q -f "$REMOTE" gh-pages
rm -rf .git
echo "Publicado. En 1-2 minutos estará en https://danielorug.github.io/app-gym/"
