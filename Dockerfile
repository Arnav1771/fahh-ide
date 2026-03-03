# Use an official Rust image as the base
FROM rust:1.68-slim as builder

# Set the working directory to /app
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . /app

# Install the dependencies
RUN cargo build --release

# Use an official Python image as the base for the backend
FROM python:3.10-slim

# Set the working directory to /app
WORKDIR /app

# Copy the requirements file
COPY requirements.txt .

# Install the dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend code
COPY backend/ /app/backend

# Set environment variables
ENV RUST_LOG=debug
ENV LOG_LEVEL=DEBUG
ENV PORT=8000

# Expose the port
EXPOSE 8000

# Use the builder image to copy the compiled Rust binary
COPY --from=builder /app/target/release/fahh-ide /app/

# Set the command to run the Rust binary and the backend
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

# Use a non-root user for better security
RUN groupadd -r fahh-ide && useradd -r -g fahh-ide fahh-ide
USER fahh-ide:fahh-ide

# Set the working directory to /app
WORKDIR /app

# Copy the frontend code
COPY frontend/ /app/frontend

# Install the frontend dependencies
RUN npm install
RUN npm run build

# Expose the port for the frontend
EXPOSE 8080

# Set the command to run the frontend
CMD ["npm", "run", "start"]