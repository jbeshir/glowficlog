# glowficlog — thin wrappers over npm scripts (deps are pre-installed; never `npm install`).
NPM := npm run --silent

.PHONY: all build dev lint lint-ext typecheck test validate package clean

all: validate

build:
	$(NPM) build

dev:
	$(NPM) dev

typecheck:
	$(NPM) typecheck

lint:
	$(NPM) lint

lint-ext:
	$(NPM) lint:ext

test:
	$(NPM) test

# Authoritative gate: typecheck + eslint + tests + build + web-ext lint.
validate:
	$(NPM) validate

# Produce Firefox (.zip via web-ext) and Chrome (.zip) artifacts from dist/.
package: build
	$(NPM) package

clean:
	rm -rf dist web-ext-artifacts
