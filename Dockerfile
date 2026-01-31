FROM node:22.4.0-alpine

WORKDIR /app

COPY package*.json tsconfig.json ./

RUN npm install

# Copy source code and ABIs
COPY src/ ./src/
COPY .env* ./

# Build
RUN npm run build

# Default command - token address is passed at runtime
ENTRYPOINT ["node", "dist/index.js"]