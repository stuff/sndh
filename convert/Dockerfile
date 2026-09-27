# sndh2opus: batch SNDH -> Opus conversion
#
# Two-stage build to keep the final image lean: gcc/gnumake are only needed to
# compile psgplay (no nixpkgs package for it) and aren't shipped in the final
# image. ffmpeg-headless (no SDL/X11) instead of ffmpeg: same codecs (including
# libopus), ~800 MB smaller since the graphics libs are useless for headless
# batch conversion.

FROM nixos/nix:latest AS builder
ENV NIX_CONFIG="experimental-features = nix-command flakes"
# git is omitted here: gcc pulls in git-minimal as a dependency (for its build
# submodules), and adding it explicitly causes a file conflict with that
# git-minimal.
# gnused/gawk: required by psgplay's Makefile version scripts (script/version).
RUN nix profile install nixpkgs#gcc nixpkgs#gnumake nixpkgs#gnused nixpkgs#gawk
RUN git clone --recurse-submodules https://github.com/frno7/psgplay /opt/psgplay \
    && make -C /opt/psgplay psgplay

FROM nixos/nix:latest AS app
ENV NIX_CONFIG="experimental-features = nix-command flakes"

# Nix base to install sc68 exactly as done locally (nixpkgs#sc68), without having
# to rebuild its homegrown build system.
RUN nix profile install \
        nixpkgs#sc68 \
        nixpkgs#ffmpeg-headless \
        nixpkgs#python3 \
    && nix-collect-garbage -d

# The nixos/nix image ships a full nixpkgs channel by default (~480 MB, for
# nix-channel/nix-shell) as well as system tools that are useless here (openssh,
# shadow...). We don't use any of it (everything goes through the "nixpkgs#..."
# flakes above, already resolved): we remove its GC root then run a garbage
# collect to purge it from the store.
# Verified afterwards: sc68/ffmpeg/python3/psgplay still work fine without it.
RUN rm -f /nix/var/nix/gcroots/docker/*-base-system \
    && nix-collect-garbage -d

# psgplay has no nixpkgs package: binary compiled in the "builder" stage above.
# /usr/local/bin isn't in this image's PATH (PATH only points at the Nix
# profile), so it's installed directly into that profile.
COPY --from=builder /opt/psgplay/psgplay /root/.nix-profile/bin/psgplay

# sc68 (via SDL2) tries to open an audio device even when writing to a file/pipe:
# there's no device in the container, hence the dummy driver.
ENV SDL_AUDIODRIVER=dummy

WORKDIR /app
COPY src/ .

# Non-root default user, so files written to /data never end up owned by root.
# 1000:1000 is only a fallback (the first user on most Linux distros):
# sndh2opus.sh runs the container with --user "$(id -u):$(id -g)", which overrides it
# with the actual host user. Nothing in the image is owned by this UID, so any
# UID works. On macOS/Windows Docker Desktop, bind-mount ownership is mapped to
# the host user anyway. Can also be baked in at build time:
#   docker build --build-arg UID=$(id -u) --build-arg GID=$(id -g) .
ARG UID=1000
ARG GID=1000
USER ${UID}:${GID}

WORKDIR /data

# Final flattening: the cleanup RUNs above (nix-collect-garbage) only remove the
# container's merged view, not the underlying Docker layer bytes (the base
# image's nixpkgs "channel" stays billed even once deleted). A COPY from a
# "scratch" stage only copies the files that are actually present in the merged
# view: this makes the cleanup stick in the final image.
FROM scratch
COPY --from=app / /
ENV PATH="/root/.nix-profile/bin:/nix/var/nix/profiles/default/bin:/nix/var/nix/profiles/default/sbin"
ENV SDL_AUDIODRIVER=dummy
ARG UID=1000
ARG GID=1000
USER ${UID}:${GID}
WORKDIR /data
ENTRYPOINT ["python3", "/app/entrypoint.py"]
