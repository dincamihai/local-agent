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
COPY memory-extension.ts /ext/memory-extension.ts
ENV PI_AGENT_CONTAINER=1
WORKDIR /workspace
ENTRYPOINT ["pi", "--no-skills", "--no-prompt-templates", "-e", "/ext/memory-extension.ts"]
