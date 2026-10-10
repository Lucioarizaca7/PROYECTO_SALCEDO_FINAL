FROM node:18-slim

# Instalar dependencias
RUN apt-get update && apt-get install -y \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf2.0-0 \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de package
COPY package*.json ./

# Instalar dependencias de Node.js incluyendo HyperFrames
RUN npm install

# Copiar el archivo de composición
COPY index_motion_graphics.html .

# Exponer puerto para desarrollo si es necesario
EXPOSE 3000

# Comando por defecto
CMD ["npx", "hyperframes", "render", "--composition", "index_motion_graphics.html"]