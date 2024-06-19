FROM debian:latest

# Base image which includes all* dependencies checked by ./mach configure.
#
# * Actually not all dependencies. WASM sandboxed depencies were left out for now.
# This installs all dependencies checked by `./mach configure --without-wasm-sandboxed-libraries`.
#
# # Building and publishing
#
# Whenever this file changes, the updated Docker image must be built and published _manually_ to
# the tor-browser container registry (https://gitlab.torproject.org/tpo/applications/tor-browser/container_registry/185).
#
# This image copies a script from the taskcluster/ folder, which requires it
# to be built from a folder which is a parent of the taskcluster/ folder.
#
# To build, run:
#
# ```bash
# docker build \
#   -f <PATH_TO_DOCKERFILE> \
#   -t <REGISTRY_URL>/<IMAGE_NAME>:<IMAGE_TAG>
#   .
# ```
#
# For example, when building from the root of this repository to the main tor-browser repository
# and assuming image name to be "base" and tag "latest" -- which is the current terminology:
#
# ```bash
# docker build \
#   -f .gitlab/ci/docker/Dockerfile \
#   -t containers.torproject.org/tpo/applications/tor-browser/base:latest
#   .
# ```

RUN apt-get update && apt-get install -y \
    clang \
    curl \
    git \
    libasound2-dev \
    libdbus-glib-1-dev \
    libgtk-3-dev \
    libpango1.0-dev \
    libpulse-dev \
    libx11-xcb-dev \
    libxcomposite-dev \
    libxcursor-dev \
    libxdamage-dev \
    libxi-dev \
    libxrandr-dev \
    libxtst-dev \
    m4 \
    mercurial \
    nasm \
    pkg-config \
    python3 \
    python3-pip \
    unzip \
    wget

COPY taskcluster/docker/recipes/install-node.sh /scripts/install-node.sh
RUN chmod +x /scripts/install-node.sh
RUN /scripts/install-node.sh

RUN curl https://sh.rustup.rs -sSf | sh -s -- -y
RUN $HOME/.cargo/bin/cargo install cbindgen

WORKDIR /app

CMD ["/bin/bash"]
