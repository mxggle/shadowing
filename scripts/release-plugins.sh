# Sourced by the release scripts: the plugins built and attached to every release, as
# <folder in plugins/>:<name in the zip's file name>. Each zip is the plugin's folder (manifest.json + bin/),
# named Shadowing-<name>-plugin-<its own version>-<macos-arm64 | windows-x86_64>.zip.
release_plugins=(youtube:YouTube furigana:Furigana)

# plugin_zip <folder> <macos-arm64 | windows-x86_64> → the zip's file name.
plugin_zip() {
  local folder="$1" platform="$2" name
  for entry in "${release_plugins[@]}"; do
    if [ "${entry%%:*}" = "$folder" ]; then name="${entry#*:}"; fi
  done
  echo "Shadowing-$name-plugin-$(node -p "require('./plugins/$folder/manifest.json').version")-$platform.zip"
}
