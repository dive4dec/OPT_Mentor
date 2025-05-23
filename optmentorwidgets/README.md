
# OPT Mentor Widgets

Jupyter Widgets for DIVE virtual learning environment. The project aims to integrate interactive learning tools into jupyter notebook. E.g.,

- [JSXGraph](https://jsxgraph.uni-bayreuth.de) for interactive demonstration of Mathematics,
- [mermaid](https://mermaid-js.github.io/mermaid) and [flowchart](https://flowchart.js.org/) for drawing diagrams with domain-specific languages, and
- [OPTLite](https://github.com/dive4dec/optlite) for serverless visualization of python program execution.

Example notebooks can be found under the [examples](./examples) folder.

## Installation

You can install using `pip`:

```bash
pip install optmentorwidgets
```



If you are using Jupyter Notebook 5.2 or earlier, you may also need to enable
the nbextension:
```bash
jupyter nbextension enable --py [--sys-prefix|--user|--system] optmentorwidgets
```

## Development Installation

Create a dev environment:
```bash
conda create -n optmentorwidgets-dev -c conda-forge nodejs python jupyterlab
conda activate optmentorwidgets-dev
```

Install the python. This will also build the TS package.
```bash
pip install -e ".[test, examples]"
```

When developing the extensions, you need to manually enable your extensions with the
notebook / lab frontend. For lab, this is done by the command:

```
jupyter labextension develop --overwrite .
jlpm run build
```

For classic notebook, you need to run:

```
jupyter nbextension install --sys-prefix --symlink --overwrite --py divewidgets
jupyter nbextension enable --sys-prefix --py divewidgets
```

Note that the `--symlink` flag doesn't work on Windows, so you will here have to run
the `install` command every time that you rebuild your extension. For certain installations
you might also need another flag instead of `--sys-prefix`.

### How to see your changes
#### Typescript:
If you use JupyterLab to develop then you can watch the source directory and run JupyterLab at the same time in different
terminals to watch for changes in the extension's source and automatically rebuild the widget.

```bash
# Watch the source directory in one terminal, automatically rebuilding when needed
jlpm run watch
# Run JupyterLab in another terminal
jupyter lab
```

After a change wait for the build to finish and then refresh your browser and the changes should take effect.

#### Python:
If you make a change to the python code then you will need to restart the notebook kernel to have it take effect.
