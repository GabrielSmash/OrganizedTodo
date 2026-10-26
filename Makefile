UUID = organizedtodo@gabrielsmash.github.io
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
FILES = extension.js client.js utils.js stylesheet.css metadata.json LICENCE icons schemas
ZIP = $(UUID).shell-extension.zip
DAEMON = organizedtodo-daemon
BUS_NAME = io.github.gabrielsmash.OrganizedTodo
BIN_DIR = $(HOME)/.local/bin
DBUS_SERVICE_DIR = $(HOME)/.local/share/dbus-1/services

.PHONY: schemas test pack install daemon install-daemon

schemas:
	glib-compile-schemas schemas

test:
	npm test

# Zip ready to share: gnome-extensions install --force $(ZIP)
# The zip holds only the extension; the daemon still has to be installed with `make install-daemon`.
# Built with zip(1), not `gnome-extensions pack`: pack flattens --extra-source paths,
# which would drop the compiled schema in the zip root instead of schemas/.
pack: schemas
	rm -f $(ZIP)
	zip -r $(ZIP) $(FILES)

# Copy into the GNOME extensions folder (not needed if this repo already lives there;
# then run only `make install-daemon`)
install: schemas install-daemon
	mkdir -p $(INSTALL_DIR)
	cp -r $(FILES) $(INSTALL_DIR)/

daemon:
	cargo build --release --manifest-path daemon/Cargo.toml

# D-Bus starts the daemon on the first call to its bus name; Exec= must be an absolute path
install-daemon: daemon
	install -Dm755 daemon/target/release/$(DAEMON) $(BIN_DIR)/$(DAEMON)
	mkdir -p $(DBUS_SERVICE_DIR)
	sed 's|@BIN_DIR@|$(BIN_DIR)|' daemon/$(BUS_NAME).service.in > $(DBUS_SERVICE_DIR)/$(BUS_NAME).service
