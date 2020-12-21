FROM node:14.2 AS build

WORKDIR /app

COPY ./ ./

RUN npm install --only=production


FROM node:14.2 as release

RUN \
    apt-get update \
    && \
    apt-get install -y \
        libx11-xcb1 \
        libxtst6 \
        libnss3 \
        libxss1 \
        libasound2 \
        libatk-bridge2.0-0 \
        libgtk-3-0 \
        fonts-wqy-zenhei \
    && \
    rm -rf /var/lib/apt/lists/*

RUN \
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && \
    /root/.cargo/bin/cargo install oxipng

WORKDIR /app

COPY --from=build /app ./

EXPOSE 3000

CMD [ "npm", "start" ]

HEALTHCHECK CMD curl -f http://localhost:3000/health || exit 1
