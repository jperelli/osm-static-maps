FROM node:13.5

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
    && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
EXPOSE 3000
CMD [ "npm", "run", "installandstartdev" ]
