# Local Aseprite exporter

This opt-in Compose profile builds the pinned Aseprite source locally and mounts only the Farmies scene assets:

```sh
docker compose --profile art build aseprite
docker compose --profile art run --rm aseprite --version
```

Edit `apps/client/src/assets/farm/cow.aseprite` with Aseprite, then regenerate its runtime atlas, face mask, and JSON metadata from the repository root:

```sh
sh tools/aseprite/export-cow.sh
```

The source contains the body and `head-mask` layers, animation tags, and one `face-N` slice per frame. The exporter is intentionally separate from the client and API images.

Aseprite permits personal source builds and commercial assets, but prohibits redistributing compiled binaries. Do not push this locally built image to a registry. See the upstream [EULA](https://github.com/aseprite/aseprite/blob/main/EULA.txt) and [CLI documentation](https://www.aseprite.org/docs/cli/).
