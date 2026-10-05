UUID = organizedtodo@gabrielsmash.github.io
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
FILES = extension.js manager.js utils.js stylesheet.css metadata.json LICENCE icons schemas
ZIP = $(UUID).shell-extension.zip

.PHONY: schemas test pack install

schemas:
	glib-compile-schemas schemas

test:
	npm test

# Zip ready to share: gnome-extensions install --force $(ZIP)
# Built with zip(1), not `gnome-extensions pack`: pack flattens --extra-source paths,
# which would drop the compiled schema in the zip root instead of schemas/.
pack: schemas
	rm -f $(ZIP)
	zip -r $(ZIP) $(FILES)

# Copy into the GNOME extensions folder (not needed if this repo already lives there)
install: schemas
	mkdir -p $(INSTALL_DIR)
	cp -r $(FILES) $(INSTALL_DIR)/
