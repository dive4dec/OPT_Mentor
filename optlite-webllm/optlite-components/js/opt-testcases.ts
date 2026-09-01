// Python Tutor: https://github.com/pgbovine/OnlinePythonTutor/
// Copyright (C) Philip Guo (philip@pgbovine.net)
// LICENSE: https://github.com/pgbovine/OnlinePythonTutor/blob/master/LICENSE.txt

export const redSadFace = require('./images/red-sad-face.jpg');
export const yellowHappyFace = require('./images/yellow-happy-face.jpg');

import { OptCmEditor } from './cm-editor';


const testcasesPaneHtml = '\
<table id="testCasesTable">\
  <thead>\
  <tr>\
    <td style="width: 310px">Tests</td>\
    <td><button id="runAllTestsButton" type="button">Run All Tests</button></td>\
    <td>Results</td>\
    <td></td>\
    <td></td>\
  </tr>\
  </thead>\
  <tbody>\
  </tbody>\
</table>\
\
<a href="#" id="addNewTestCase">Add new test</a>\
'

export class OptTestcases {
  parent: any; // type: OptFrontendWithTestcases
  curTestcaseId: number = 1;

  constructor(parent) {
    this.parent = parent;
    $("#testCasesParent")
      .empty() // just to be paranoid, empty this out (and its event handlers, too, supposedly)
      .html('<p style="margin-top: 10px;"><a href="#" id="createTestsLink">Create test cases</a></p><div id="testCasesPane"></div>');

    $("#testCasesParent #createTestsLink").click(() => {
      this.initTestcasesPane();
      $("#testCasesParent #createTestsLink").hide();
      return false;
    });
  }

  initTestcasesPane() {
    var _me = this;
    $("#testCasesParent #testCasesPane")
      .empty() // just to be paranoid, empty this out (and its event handlers, too, supposedly)
      .html(testcasesPaneHtml);

    $("#addNewTestCase").click(function() {
      _me.addTestcase(null);
      return false; // to prevent link from being followed
    });
    $("#runAllTestsButton").click(async () => {
      const testCases = $("#testCasesTable tbody tr");
      $("#runAllTestsButton").attr('disabled', true);
      
      for (let i = 0; i < testCases.length; i++) {
      const testNumber = $(testCases[i]).attr('id').split('_')[1];
      await new Promise<void>((resolve) => {
        const checkComplete = setInterval(() => {
        if (!$("#runTestCase_" + testNumber).prop('disabled')) {
          clearInterval(checkComplete);
          resolve();
        }
        }, 100);
        $("#runTestCase_" + testNumber).click();
      });
      }
      
      $("#runAllTestsButton").attr('disabled', false);
    });
  }

  loadTestCases(lst: string[]) {
    this.initTestcasesPane();
    $("#testCasesParent #createTestsLink").hide();
    lst.forEach((e) => {
      this.addTestcase(e);
    });
  }

  addTestcase(initialCod /* optional code to pre-seed this test */) {
    var _me = this;

    var id = this.curTestcaseId;
    this.curTestcaseId++;
    var newTr = $('<tr/>').attr('id', 'testCaseRow_' + id);
    $("#testCasesParent #testCasesTable tbody").append(newTr);
    var editorTd = $('<td/>');
    var runBtnTd = $('<td/>');
    var outputTd = $('<td/>');
    var visualizeTd = $('<td/>');
    var deleteTd = $('<td/>');

    editorTd.append('<div id="testCaseEditor_' + id + '" class="testCaseEditor">');
    runBtnTd.append('<button id="runTestCase_' + id + '" class="runTestCase" type="button">Run</button>');
    outputTd.attr('id', 'outputTd_' + id);
    outputTd.attr('class', 'outputTd');
    visualizeTd.append('<button id="vizTestCase_' + id + '" class="vizTestCase" type="button">Visualize</button>');
    deleteTd.append('<a id="delTestCase_' + id + '" href="javascript:void(0);">Delete test</a></td>');

    newTr.append(editorTd);
    newTr.append(runBtnTd);
    newTr.append(outputTd);
    newTr.append(visualizeTd);
    newTr.append(deleteTd);

    // initialize testCaseEditor with CodeMirror 6:
    // (CM6 has no ace.edit(id) global cache, so we store the instance on its
    // container element and read it back by id below.)
    const teEl = document.getElementById('testCaseEditor_' + id) as any;
    const te = new OptCmEditor({
      container: teEl,
      value: '',
      mode: 'python',
      tabSize: 2,
      fontSize: '11px',
      onChange: () => {
        $('#outputTd_' + id).empty(); // remove all test output indicators
      },
    });
    teEl.env = { editor: te }; // stashed for read-back by id (getCombinedCode, etc.)

    // TODO: change syntax highlighting mode if the user changes languages:
    var lang = $('#pythonVersionSelector').val();
    var mod = 'python';
    var defaultVal = '\n# assert <test condition>';
    if (lang === 'java') {
      mod = 'java';
      defaultVal = '// sorry, Java tests not yet supported';
    } else if (lang === 'c' || lang === 'cpp') {
      mod = 'c_cpp';
      defaultVal = '// sorry, C/C++ tests not yet supported';
    } else if (lang === 'js') {
      mod = 'javascript';
      defaultVal = '\n// console.assert(<test condition>);';
    } else if (lang === 'ts') {
      mod = 'typescript';
      defaultVal = '\n// console.assert(<test condition>);';
    } else if (lang === 'ruby') {
      mod = 'ruby';
      defaultVal = "\n# raise 'fail' unless <test condition>";
    }
    te.setMode(mod);

    te.setValue(initialCod ? initialCod.rtrim() : defaultVal);
    te.focus();

    function runOrVizTestCase(isViz /* true for visualize, false for run */) {
      $("#runAllTestsButton,.runTestCase,.vizTestCase").attr('disabled', true);
      $('#outputTd_' + id).html('');

      var dat = _me.getCombinedCode(id);
      var cod = dat.cod;

      if (isViz) {
        $('#vizTestCase_' + id).html("Visualizing ...");
        _me.parent.vizTestCase(id, cod, dat.firstTestLine);
      } else {
        $('#runTestCase_' + id).html("Running ...");
        _me.parent.runTestCase(id, cod, dat.firstTestLine);
      }
    }

    $('#runTestCase_' + id).click(runOrVizTestCase.bind(this, false));
    $('#vizTestCase_' + id).click(runOrVizTestCase.bind(this, true));

    $('#delTestCase_' + id).click(function() {
      $('#testCaseRow_' + id).remove();
      return false; // to prevent link from being followed
    });
  }

  doneRunningTest() {
    $("#runAllTestsButton,.runTestCase,.vizTestCase").attr('disabled', false);
    $(".runTestCase").html('Run');
    $(".vizTestCase").html('Visualize');
  }

  // retrieve a test-case editor instance by its DOM id. CM6 has no
  // ace.edit(id) global cache, so we read the OptCmEditor off the element's
  // stashed `.env.editor` (set in addTestcase).
  getTestCaseEditor(id: number): any {
    var el = document.getElementById('testCaseEditor_' + id) as any;
    return el && el.env && el.env.editor;
  }

  getCombinedCode(id) {
    var userCod = this.parent.pyInputGetValue();
    var te = this.getTestCaseEditor(id);
    var testCod = te ? te.getValue() : '';
    // for reporting syntax errors separately for user and test code
    var userCodNumLines = userCod.split('\n').length;

    var lang = $('#pythonVersionSelector').val();
    if (lang === 'ts' || lang === 'js' || lang === 'java' || lang === 'c' || lang === 'cpp') {
      var bufferCod = '\n\n// Test code //\n';
    } else {
      var bufferCod = '\n\n## Test code ##\n';
    }

    var bufferCodNumLines = bufferCod.split('\n').length;

    var combinedCod = userCod + bufferCod + testCod;
    return {cod: combinedCod,
            firstTestLine: userCodNumLines + bufferCodNumLines - 1};
  }

  appStateAugmenter(appState) {
    // returns a list of strings, each of which is a test case
    function getAllTestcases() {
      return $.map($("#testCasesParent #testCasesTable .testCaseEditor"),
      (e) => {
        var ed = (e as any).env && (e as any).env.editor;
        return ed ? ed.getValue() : '';
      });
    }

    var tc = getAllTestcases();
    if (tc.length > 0) {
      appState['testCasesJSON'] = JSON.stringify(tc);
    }
  }

} // END class OptTestcases
