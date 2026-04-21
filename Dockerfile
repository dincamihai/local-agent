FROM node:20-slim
RUN apt-get update && apt-get install -y \
    python3 python3-pip cmake build-essential \
    libopenblas-dev liblapack-dev libx11-dev \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --break-system-packages face_recognition opencv-python-headless numpy pygame
RUN npm install -g @mariozechner/pi-coding-agent
RUN mkdir -p /root/.pi/agent /ext
COPY pi-settings.json /root/.pi/agent/settings.json
COPY pi-models.json /root/.pi/agent/models.json
COPY lance-extension.ts /ext/lance-extension.ts
COPY membrain-extension.ts /ext/membrain-extension.ts
COPY entrypoint.sh /ext/entrypoint.sh
RUN chmod +x /ext/entrypoint.sh
ENV PI_AGENT_CONTAINER=1
WORKDIR /workspace
ENTRYPOINT ["/ext/entrypoint.sh"]
