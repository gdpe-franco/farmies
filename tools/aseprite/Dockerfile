FROM ubuntu:24.04 AS builder

ARG ASEPRITE_VERSION=v1.3.18.5

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates clang cmake curl g++ git libfontconfig1-dev libgl1-mesa-dev \
      libx11-dev libxcursor-dev libxi-dev libxrandr-dev ninja-build unzip \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --branch "${ASEPRITE_VERSION}" --depth 1 --recurse-submodules --shallow-submodules \
    https://github.com/aseprite/aseprite.git /opt/aseprite-src

WORKDIR /opt/aseprite-src
RUN ./build.sh --auto --norun

FROM builder AS stripped
RUN strip /opt/aseprite-src/build/bin/aseprite

FROM ubuntu:24.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates libfontconfig1 libgl1 libx11-6 libxcursor1 libxi6 libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=stripped /opt/aseprite-src/build/bin /opt/aseprite
RUN ln -s /opt/aseprite/aseprite /usr/local/bin/aseprite

ENTRYPOINT ["aseprite", "--batch"]
CMD ["--version"]
