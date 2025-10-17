# OPM (Offline Python Mentor)

OPM is a serverless implementation of Online Python Tutor Lite (OPTLite) designed for offline use and enhanced educational environments. This project builds upon the [optlite](https://github.com/dive4dec/optlite) concept while making it more accessible and secure for educational settings. Integrated with [WEBLLM](https://github.com/mlc-ai/web-llm) for advanced language model capabilities.

📌 Visit [https://dive4dec.github.io/OPT_Mentor/](https://dive4dec.github.io/OPT_Mentor/) to have a try!


## Features

- ✨ **Serverless Operation**: Runs entirely in the browser using [Pyodide](https://pyodide.org)
- **Offline Capability**: Can be used without internet connection
- **Enhanced Security**: No server-side code execution, reducing security risks
- **Educational Focus**: Perfect for classroom settings and online exams
- **Safe Exam Browser Compatible**: Works with [Safe Exam Browser](https://safeexambrowser.org/) 
  > ⚠️ The AI model does not work with Safe Exam Browser at present.
- **Interactive Visualization**: Visual representation of Python program execution
- **Live Editing Mode**: Real-time code editing and visualization
- ✨ **Socratic AI hints**: Provide Socratic style hints instead of answers with the fine-tuned LLM model.

## 💡 Tutorial 💡
<details open>
<summary>💡(Click to expand/collapse)</summary>

➡️ Starting Page

![OPTMentor main page](./screenshots/OPTMentor_main_page.jpg)
After you enter your code:
- The `Visulize` button will navigate you to the page for visualizing the execution.
- The `Live Edit` button will navigate you to the page featuring a fine-tuned LLM mode that provides Socratic hints.
- The `Permalink` button will generate a shareable link.

➡️ Visualization Mode
![OPTMentor visualization of excution](./screenshots/OPTMentor_visualize_display.jpg)
Here you can:
- View the visualization of variables, etc., in the right-hand side area.
- Inspect the execution step-by-step either by dragging the progress bar or by clicking the `<< First`, `<Prev`, and other buttons.
- Clicking "Edit this code" will navigate you back to the code editing page, where you can also choose to enter the live editing mode. 

➡️ Live Editing Mode with LLM Integrated
![OPTMentor live edit page 1](./screenshots/OPTMentor_live_edit_1.jpg)
Visit the live editing page:
- The LLM model will be automatically downloaded and loaded, You can also click `Pull Model` button to retry when needed.
- The downloaded model will be cached in the browser. The `Reset Local State` button allows you to clear the cache and refresh the page, simulating a first-time visit.

![OPTMentor live edit page 2](./screenshots/OPTMentor_live_edit_2.jpg)
- When you see the message under the `Pull Model` button reads like "Finish loading on WebGPU...", it means the LLM model has been successfully loaded.
- When your code encounters an error, the `Ask AI` button will appear. Clicking on it will provide you with Socratic hints from the AI.
- You can return to the Visualization page (which focuses on execution visualization) using the `Visualize` button below the code box.

</details>

## ✨ Anti-Jailbreak
<details open>
<summary> An Example of Anti-Jailbreak (Click to expand/collapse)</summary>

![OPTMentor anti jailbreak](./screenshots/OPTMentor_anti_jailbreak.jpg)
Users may attempt to jailbreak the LLM by directly asking for the answer, which must be prevented when using this AI-integrated tool for exams. The screenshot below shows an example where our fine-tuned model successfully prevented the jailbreak attempt.
</details>





## Installation (Github Action)
The pages are automaticly compiled with github action, and pushed to the [`gh-pages`](https://github.com/dive4dec/OPT_Mentor/tree/gh-pages) branch. Those compiled files will work with a web server.

## Installation (for local host)
1. Ensure you have Docker installed on your system
2. Run the command in cmd or terminal
   ```docker-compose up -d --build```
3. The script will:
   - Build the Docker image of optlite-webllm and AI-model
   - RUN the docker container

## Project Structure

```
OPM_Mentor
├── AI-Model                 # AI model component
├── JupyterLite              # The JupyterLite component
└── optlite-webllm           # the integraded optlite and webllm
```

## Usage
Run the container with:
```bash
docker-compose up -d --build
```

Access at http://localhost:8000

for stop the service
```bash
docker-compose down
```

## Development
The project consists of several key components:
- **OPT Lite**: The core visualization engine
- **JupyterLite Integration**: For notebook-based interactions
- **WebLLM Integration**: For serverless AI assistant
- **Pyodide Runtime**: For in-browser Python execution
- **[optmwidgets](https://github.com/chiwangso2/optmwidgets)**: A widget built on top of [divewidgets](https://github.com/dive4dec/divewidgets) that provide programming ai assistant using webllm and langchain.

## Requirements
- Docker

## Acknowledgments

- Based on [optlite](https://github.com/dive4dec/optlite)
- Uses [Pyodide](https://pyodide.org) for in-browser Python execution
- Integrates with [JupyterLite](https://jupyterlite.readthedocs.io/) for notebook functionality 
