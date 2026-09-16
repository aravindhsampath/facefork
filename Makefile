.PHONY: dev build gallery demo deploy clean
dev: node_modules
	npm run dev
build: node_modules
	npm run build

# Share-format specimen gallery: bundles src/share and inlines it with the demo painting
# into one self-contained page. Everything stays on this machine.
gallery: node_modules demo/mona-780.jpg
	npm exec -- vite build --config vite.demo.config.js
	node demo/build.mjs
	open demo/dist/gallery.html

# Ship dist/ to Cloudflare Pages (free plan, no card). First time: `npm exec -- wrangler login`,
# then create the project once in the dashboard or with `wrangler pages project create facefork`.
deploy: build
	npm exec --yes -- wrangler@latest pages deploy dist --project-name facefork --commit-dirty=true

# Regenerate the bundled demo tree (needs OPEN_ROUTER_KEY in .env; only missing images are generated).
demo:
	node scripts/make-demo.mjs

demo/mona-780.jpg: scripts/masters/mona-lisa.jpg
	sips -Z 780 $< --out $@ >/dev/null

clean:
	rm -rf dist demo/dist demo/mona-780.jpg

node_modules: package.json
	npm install
