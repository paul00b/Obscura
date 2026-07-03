FROM node:20-alpine

WORKDIR /app

# Fuseau horaire : sans ça, Alpine tourne en UTC et les dates de reveal
# (saisies en heure locale) seraient décalées. tzdata rend TZ effectif.
RUN apk add --no-cache tzdata
ENV TZ=Europe/Paris

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source
COPY . .

# Default data path (overridable)
ENV DATA_PATH=/data
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "src/index.js"]
