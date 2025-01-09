# OPM (Online Python Mentor)

OPM is a serverless implementation of Online Python Tutor Lite (OPTLite) designed for offline use and enhanced educational environments. This project builds upon the [optlite](https://github.com/dive4dec/optlite) concept while making it more accessible and secure for educational settings.

## Features

- **Serverless Operation**: Runs entirely in the browser using [Pyodide](https://pyodide.org)
- **Offline Capability**: Can be used without internet connection
- **Enhanced Security**: No server-side code execution, reducing security risks
- **Educational Focus**: Perfect for classroom settings and online exams
- **Safe Exam Browser Compatible**: Works with [Safe Exam Browser](https://safeexambrowser.org/)
- **Interactive Visualization**: Visual representation of Python program execution
- **Live Editing Mode**: Real-time code editing and visualization

## Project Structure

```
OPT_Mentor
├── optlite-components/                 # Core visualization components
├── opm-0.0.1-py2.py3-none-any.whl      # Python package wheel (upload to pypi later)
├── pack_optlite.sh                     # Script for packaging the application
└── setup_opm.sh                        # Setup script for OPM environment
```

## Setup

1. Ensure you have Docker installed on your system
2. Run the setup script:
   ```bash
   ./setup_opm.sh
   ```
3. The script will:
   - Set up the necessary environment
   - Build the Docker image
   - Configure the JupyterLite environment

## Usage

After setup, you can run the container with:
```bash
docker run -p 8888:8000 opt-mentor --name opt-mentor
```

And access at localhost:8888

## Development

The project consists of several key components:
- **OPT Lite**: The core visualization engine
- **JupyterLite Integration**: For notebook-based interactions
- **Pyodide Runtime**: For in-browser Python execution

## Requirements

- Docker
- Python 3.12
- Node.js (for development)
- Modern web browser with JavaScript enabled

## Acknowledgments

- Based on [optlite](https://github.com/dive4dec/optlite)
- Uses [Pyodide](https://pyodide.org) for in-browser Python execution
- Integrates with [JupyterLite](https://jupyterlite.readthedocs.io/) for notebook functionality 