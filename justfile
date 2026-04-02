default:
  just --list

dev:
  npm run dev

dev-client:
  npm run dev:client

build:
  npm run build

test:
  cd src-tauri && cargo test

install:
  npm install
