# fahh-ide: Ultra-Fast Lightweight IDE

## Overview

fahh-ide is an ultra-fast and lightweight Integrated Development Environment (IDE) built with Rust, Leptos, CodeMirror 6, Highlight.js, Tauri, Actix-web, and Vercel. It provides a seamless coding experience with features like syntax highlighting, code completion, and debugging.

## Features

* Ultra-fast and lightweight
* Syntax highlighting with Highlight.js
* Code completion with CodeMirror 6
* Debugging with Actix-web
* Modern dark and light themes with gradient accents
* Smooth animations and mobile-responsive design
* Secure and scalable with Tauri and Vercel

## Setup Guide

### Prerequisites

* Rust 1.64 or higher
* Node.js 16 or higher
* Docker 20 or higher
* Vercel CLI

### Installation

1. Clone the repository: `git clone https://github.com/fahh-ide/fahh-ide.git`
2. Install dependencies: `cargo build` and `npm install`
3. Start the development server: `cargo run` and `npm run dev`
4. Open the IDE in your browser: `http://localhost:8000`

### Docker Setup

1. Build the Docker image: `docker build -t fahh-ide .`
2. Run the Docker container: `docker run -p 8000:8000 fahh-ide`
3. Open the IDE in your browser: `http://localhost:8000`

### Environment Variables

* `VERCEL_TOKEN`: Vercel API token
* `VERCEL_PROJECT_ID`: Vercel project ID
* `VERCEL_ORG_ID`: Vercel organization ID
* `LOG_LEVEL`: Log level (debug, info, warn, error)

### Logging

* Log level can be set using the `LOG_LEVEL` environment variable
* Logs are written to the console and a log file

### Security

* Follow best security practices for Dockerfiles
* Use environment variables for secrets
* Keep dependencies up to date

### Contributing

* Fork the repository
* Create a new branch
* Make changes and commit
* Open a pull request

### License

* MIT License

### Credits

* Built with Rust, Leptos, CodeMirror 6, Highlight.js, Tauri, Actix-web, and Vercel
* Inspired by existing IDEs and code editors

<style>
  body {
    font-family: 'Inter', sans-serif;
    margin: 0;
    padding: 0;
    background-color: #f0f0f0;
    color: #333;
    transition: background-color 0.3s ease;
  }
  .dark-mode {
    background-color: #333;
    color: #f0f0f0;
  }
  .light-mode {
    background-color: #f0f0f0;
    color: #333;
  }
  .gradient-accents {
    background-image: linear-gradient(to bottom, #ff69b4, #ffe6cc);
    background-size: 100% 300px;
    background-position: 0% 100%;
    animation: gradient-accents 10s ease infinite;
  }
  @keyframes gradient-accents {
    0% {
      background-position: 0% 100%;
    }
    50% {
      background-position: 100% 0%;
    }
    100% {
      background-position: 0% 100%;
    }
  }
  @media (max-width: 768px) {
    body {
      font-size: 16px;
    }
  }
  @media (max-width: 480px) {
    body {
      font-size: 14px;
    }
  }
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap">