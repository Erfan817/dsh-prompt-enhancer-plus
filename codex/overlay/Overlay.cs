using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Collections.Generic;

namespace PromptSpark {
  internal static class Native {
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] internal static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  }
  internal sealed class Snapshot {
    internal IntPtr Window;
    internal int[] RuntimeId;
    internal string Original;
    internal bool Invalid;
    internal bool Matches(IntPtr window, int[] runtimeId, string value) {
      return !Invalid && Window == window && RuntimeId.SequenceEqual(runtimeId) && Original == value;
    }
  }
  // Same review/apply/undo contract as the Claude plugin; host I/O stays in OverlayApp.
  internal sealed class DraftReview {
    internal readonly Snapshot Source;
    internal Snapshot Undo;
    internal string Enhanced = "", Notice = "";
    internal int Level;
    internal DraftReview(Snapshot source, int level) { Source = source; Level = level; }
    internal bool CanApply { get { return !Source.Invalid && Undo == null && !String.IsNullOrWhiteSpace(Enhanced); } }
    internal bool CanUndo { get { return Undo != null && !Undo.Invalid; } }
    internal void Invalidate(string reason) {
      Source.Invalid = true;
      if (Undo != null) Undo.Invalid = true;
      Notice = reason;
    }
    internal void Observe(IntPtr window, int[] id, string text) {
      var expected = Undo ?? Source;
      if (!expected.Invalid && !expected.Matches(window,id,text))
        Invalidate("输入框已改变，旧预览不能替换或撤销覆盖新内容。可复制结果或重新强化。");
    }
    internal void Applied(string actual) {
      Source.Invalid = true;
      Undo = new Snapshot { Window = Source.Window, RuntimeId = (int[])Source.RuntimeId.Clone(), Original = actual };
      Notice = "已替换草稿，尚未发送。离开预览或修改输入框前可撤销。";
    }
    internal void Undone() {
      Undo = null; Source.Invalid = true;
      Notice = "已恢复原草稿，尚未发送。强化结果仍保留，可复制。";
    }
  }
  internal sealed class RequestEpoch {
    private long value;
    internal long Begin() { return Interlocked.Increment(ref value); }
    internal bool IsCurrent(long token) { return Interlocked.Read(ref value) == token; }
    internal void Cancel() { Interlocked.Increment(ref value); }
  }
  internal sealed class FloatingButton : Form {
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override void WndProc(ref Message message) {
      // WS_EX_NOACTIVATE is not enough for every child-button mouse activation path.
      // Preserve Codex as the target until the click handler has opened the preview.
      if (message.Msg == 0x0021) { message.Result = new IntPtr(3); return; } // WM_MOUSEACTIVATE / MA_NOACTIVATE
      base.WndProc(ref message);
    }
    protected override CreateParams CreateParams {
      get { var value = base.CreateParams; value.ExStyle |= 0x08000000 | 0x00000080; return value; }
    }
    internal FloatingButton() {
      FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
      StartPosition = FormStartPosition.Manual; Size = new Size(178, 34);
      BackColor = Color.FromArgb(77,107,254); Text = "Prompt Spark · Codex";
    }
  }
  public sealed class OverlayApp : ApplicationContext {
    private readonly string targetExe, backendExe, nodeExe, worker, runtime;
    private readonly FloatingButton floating = new FloatingButton();
    private readonly Button trigger = new Button();
    private readonly Button previewTrigger = new Button();
    private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private IntPtr targetWindow;
    private AutomationElement composer;
    private DraftReview review;
    private Snapshot snapshot { get { return review == null ? null : review.Source; } }
    private Form preview;
    private TextBox output;
    private ComboBox levels;
    private Label status;
    private Button generate, apply, cancel, undo, copy;
    private Process requestProcess;
    private readonly object requestGate = new object();
    private bool busy, stopping, openingPreview;
    private readonly RequestEpoch requests = new RequestEpoch();
    private int selectedLevel = 1;

    private void Log(string code, Exception error = null) {
      if (String.IsNullOrEmpty(runtime)) return;
      try {
        var file = Path.Combine(runtime,"overlay.log");
        if (File.Exists(file) && new FileInfo(file).Length > 128 * 1024) File.WriteAllText(file,"");
        // No draft, generated text, account data or arbitrary exception message in diagnostics.
        File.AppendAllText(file, DateTimeOffset.Now.ToString("o") + " " + code +
          (error == null ? "" : " " + error.GetType().Name + " hresult=" + error.HResult + " " + error.StackTrace) + Environment.NewLine);
      } catch { }
    }

    private OverlayApp(string target, string backend, string node, string script, string data, bool test = false) {
      targetExe = Path.GetFullPath(target); backendExe = backend; nodeExe = node; worker = script; runtime = data;
      trigger.Text = "✦ 强化"; trigger.Dock = DockStyle.Left; trigger.Width = 106; trigger.FlatStyle = FlatStyle.Flat;
      trigger.FlatAppearance.BorderSize = 0; trigger.ForeColor = Color.White;
      trigger.BackColor = floating.BackColor; trigger.Font = new Font("Microsoft YaHei UI", 10);
      trigger.Click += (sender,args) => OpenPreview(true); floating.Controls.Add(trigger);
      previewTrigger.Text = "预览"; previewTrigger.Dock = DockStyle.Fill; previewTrigger.FlatStyle = FlatStyle.Flat;
      previewTrigger.FlatAppearance.BorderSize = 0; previewTrigger.ForeColor = Color.White;
      previewTrigger.Font = trigger.Font; previewTrigger.BackColor = Color.FromArgb(60,85,216);
      previewTrigger.Click += (sender,args) => OpenPreview(false); floating.Controls.Add(previewTrigger);
      previewTrigger.BringToFront();
      var menu = new ContextMenuStrip();
      menu.Items.Add("打开预览（不调用模型）", null, (sender,args) => OpenPreview(false));
      menu.Items.Add("退出 Codex 悬浮按钮", null, (sender,args) => Stop());
      trigger.ContextMenuStrip = menu; previewTrigger.ContextMenuStrip = menu;
      timer.Interval = 650; timer.Tick += (sender,args) => Tick();
      floating.Handle.ToString();
      if (!test) {
        timer.Start(); Tick();
        File.WriteAllText(Path.Combine(runtime, "overlay.pid"), Process.GetCurrentProcess().Id.ToString());
        Log("overlay.started");
      }
    }
    private bool IsTarget(IntPtr window) {
      try {
        if (window == IntPtr.Zero || Native.IsIconic(window)) return false;
        uint pid; Native.GetWindowThreadProcessId(window, out pid);
        using (var process = Process.GetProcessById((int)pid))
          return String.Equals(Path.GetFullPath(process.MainModule.FileName), targetExe, StringComparison.OrdinalIgnoreCase);
      } catch { return false; }
    }
    private static AutomationElement FindComposer(IntPtr window) {
      var root = AutomationElement.FromHandle(window);
      var list = root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));
      var candidates = new List<AutomationElement>();
      foreach (AutomationElement item in list) {
        object pattern;
        if (item.Current.ClassName.Split(' ').Contains("ProseMirror") &&
            !item.Current.IsOffscreen && item.Current.IsEnabled && item.Current.IsKeyboardFocusable &&
            !item.Current.BoundingRectangle.IsEmpty && item.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) &&
            !((ValuePattern)pattern).Current.IsReadOnly) candidates.Add(item);
      }
      // Multiple rich editors means the target is ambiguous: don't guess.
      return candidates.Count == 1 ? candidates[0] : null;
    }
    private static string Read(AutomationElement editor) {
      return ((ValuePattern)editor.GetCurrentPattern(ValuePattern.Pattern)).Current.Value;
    }
    private void Invalidate(string reason) {
      if (review != null) review.Invalidate(reason);
      if (apply != null && !apply.IsDisposed) apply.Enabled = false;
      if (undo != null && !undo.IsDisposed) undo.Enabled = false;
      if (status != null && !status.IsDisposed && !busy) status.Text = reason;
    }
    private void Tick() {
      if (stopping || openingPreview) return;
      try {
        var foreground = Native.GetForegroundWindow();
        uint foregroundPid; Native.GetWindowThreadProcessId(foreground, out foregroundPid);
        bool ownPreview = preview != null && !preview.IsDisposed && foregroundPid == Process.GetCurrentProcess().Id;
        if (ownPreview) { floating.Hide(); ValidateSnapshot(); return; }
        if (!IsTarget(foreground)) {
          floating.Hide(); composer = null;
          if (snapshot != null) Invalidate("已切换到其他应用，请关闭预览后重新点击强化。");
          return;
        }
        targetWindow = foreground; composer = FindComposer(targetWindow);
        if (composer == null) { floating.Hide(); if (snapshot != null) Invalidate("未能唯一定位输入框，请重新打开预览。"); return; }
        ValidateSnapshot();
        if (preview != null && !preview.IsDisposed) {
          Invalidate("已回到 Codex 窗口，本次预览不再回填；请关闭后重新点击强化。");
          if (preview.Visible && Native.IsWindowVisible(preview.Handle) && !Native.IsIconic(preview.Handle)) { floating.Hide(); return; }
          // A hidden/minimized preview must never suppress the only recovery entry point.
        }
        var rect = composer.Current.BoundingRectangle;
        var area = Screen.FromPoint(new Point((int)rect.Left,(int)rect.Top)).WorkingArea;
        floating.Location = new Point(Math.Max(area.Left, Math.Min(area.Right - floating.Width, (int)rect.Left)),
          Math.Max(area.Top, (int)rect.Top - floating.Height - 7));
        if (!floating.Visible) floating.Show();
      } catch { floating.Hide(); if (snapshot != null) Invalidate("输入框已变化，请重新点击强化。"); }
    }
    private void ValidateSnapshot() {
      if (review == null || (snapshot.Invalid && !review.CanUndo)) return;
      try {
        if (!IsTarget(snapshot.Window)) { Invalidate("Codex 窗口已关闭或最小化，请重新打开预览。"); return; }
        var editor = FindComposer(snapshot.Window);
        if (editor == null) { Invalidate("未能唯一定位输入框，已禁止替换和撤销。"); return; }
        review.Observe(snapshot.Window, editor.GetRuntimeId(), Read(editor));
        RefreshActions();
        if (snapshot.Invalid && !review.CanUndo && status != null && !status.IsDisposed && !busy) status.Text = review.Notice;
      } catch { Invalidate("输入框已变化，请重新点击强化。"); }
    }
    private void OpenPreview(bool startEnhancement) {
      if (openingPreview) return;
      openingPreview = true;
      Log(startEnhancement ? "enhance.clicked" : "preview.clicked");
      try {
        if (preview != null && !preview.IsDisposed) { ShowPreview(); return; }
        var foreground = Native.GetForegroundWindow();
        uint foregroundPid; Native.GetWindowThreadProcessId(foreground, out foregroundPid);
        if (foregroundPid == Process.GetCurrentProcess().Id) foreground = targetWindow;
        if (!IsTarget(foreground)) { Log("preview.target-unavailable"); return; }
        if (!startEnhancement && review != null) {
          if (snapshot.Window != foreground) Invalidate("这是上一窗口的预览，仅供查看和复制。");
          BuildPreview(); ShowPreview(); return;
        }
        var editor = FindComposer(foreground);
        if (editor == null) { Log("preview.composer-unavailable"); MessageBox.Show("暂时无法定位 Codex 输入框，请回到输入框后重试。", "Prompt Spark"); return; }
        var original = Read(editor);
        if (startEnhancement && String.IsNullOrWhiteSpace(original)) { MessageBox.Show("先在 Codex 输入框里写下需要强化的草稿。", "Prompt Spark"); return; }
        if (original.Length > 12000) { MessageBox.Show("草稿超过 12000 字符，请缩短后再强化。", "Prompt Spark"); return; }
        review = new DraftReview(new Snapshot { Window = foreground, RuntimeId = editor.GetRuntimeId(), Original = original }, selectedLevel);
        Log("preview.draft-captured");
        BuildPreview(); ShowPreview();
        if (startEnhancement) Generate(original);
        else { review.Notice = "仅打开预览，尚未调用模型。"; status.Text = review.Notice; }
      } catch (Exception error) {
        Log("preview.open-failed",error);
        if (preview != null && !preview.IsDisposed && !preview.Visible) { preview.Dispose(); preview = null; }
        MessageBox.Show("预览窗口未能打开，请重试。原草稿未改动。", "Prompt Spark");
      } finally { openingPreview = false; }
    }
    private void ShowPreview() {
      var form = preview;
      if (form == null || form.IsDisposed) throw new InvalidOperationException("No preview form.");
      form.WindowState = FormWindowState.Normal;
      if (!form.Visible) {
        var area = targetWindow == IntPtr.Zero ? Screen.PrimaryScreen.WorkingArea : Screen.FromHandle(targetWindow).WorkingArea;
        form.StartPosition = FormStartPosition.Manual;
        form.Location = new Point(area.Left + Math.Max(0,(area.Width-form.Width)/2), area.Top + Math.Max(0,(area.Height-form.Height)/2));
        form.Show();
      }
      // Restore also handles a native-hidden form whose managed Visible flag is still true.
      Native.ShowWindow(form.Handle,9);
      Native.SetWindowPos(form.Handle,IntPtr.Zero,0,0,0,0,0x0001 | 0x0002 | 0x0040);
      form.BringToFront(); form.Activate(); Native.SetForegroundWindow(form.Handle);
      if (!Native.IsWindowVisible(form.Handle)) throw new InvalidOperationException("Preview remained hidden.");
      Log("preview.visible");
      floating.Hide();
    }
    private void BuildPreview() {
      preview = new Form { Text = "Prompt Spark · Codex 草稿强化", Size = new Size(780,650), MinimumSize = new Size(560,460),
        StartPosition = FormStartPosition.CenterScreen, Font = new Font("Microsoft YaHei UI",10), BackColor = Color.White, KeyPreview = true };
      var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 1, RowCount = 7 };
      layout.RowStyles.Add(new RowStyle(SizeType.Absolute,60)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute,43));
      layout.RowStyles.Add(new RowStyle(SizeType.Percent,100)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute,58));
      layout.RowStyles.Add(new RowStyle(SizeType.Absolute,34)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute,0));
      layout.RowStyles.Add(new RowStyle(SizeType.Absolute,55));
      layout.Controls.Add(new Label { Text = "审阅并编辑强化结果，再确认替换原草稿。\n使用 Codex 配置的默认模型；不会自动发送。", Dock = DockStyle.Fill },0,0);
      var controls = new FlowLayoutPanel { Dock = DockStyle.Fill };
      levels = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 180 };
      levels.Items.AddRange(new object[] { "简洁 · 轻度润色", "标准 · 清晰结构", "详细 · 边界与验收" }); levels.SelectedIndex = review.Level;
      levels.SelectedIndexChanged += (sender,args) => { selectedLevel = levels.SelectedIndex; review.Level = selectedLevel; };
      generate = new Button { Text = "再次强化预览", AutoSize = true };
      generate.Click += (sender,args) => Generate(String.IsNullOrWhiteSpace(output.Text) ? snapshot.Original : output.Text);
      controls.Controls.Add(levels); controls.Controls.Add(generate); layout.Controls.Add(controls,0,1);
      output = new TextBox { Multiline = true, AcceptsReturn = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, MaxLength = 24000 };
      output.Text = review.Enhanced;
      output.TextChanged += (sender,args) => { review.Enhanced = output.Text; RefreshActions(); };
      layout.Controls.Add(output,0,2);
      var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(0,6,0,0) };
      apply = new Button { Text = "替换原草稿", AutoSize = true, Enabled = false };
      apply.Click += (sender,args) => Apply();
      undo = new Button { Text = "撤销替换", AutoSize = true, Enabled = false };
      undo.Click += (sender,args) => Undo();
      copy = new Button { Text = "复制", AutoSize = true, Enabled = false };
      copy.Click += (sender,args) => {
        if (String.IsNullOrWhiteSpace(output.Text)) return;
        try { Clipboard.SetText(output.Text); status.Text = "已复制预览，未粘贴或发送。"; }
        catch { output.Focus(); output.SelectAll(); status.Text = "剪贴板暂不可用，已选中预览，请按 Ctrl+C。"; }
      };
      cancel = new Button { Text = "取消强化", AutoSize = true, Enabled = false };
      cancel.Click += (sender,args) => Cancel();
      var close = new Button { Text = "关闭", AutoSize = true }; close.Click += (sender,args) => preview.Close();
      actions.Controls.Add(apply); actions.Controls.Add(undo); actions.Controls.Add(copy); actions.Controls.Add(cancel); actions.Controls.Add(close); layout.Controls.Add(actions,0,3);
      var originalToggle = new LinkLabel { Text = "查看原草稿", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft };
      var original = new TextBox { Text = snapshot.Original, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, Visible = false, TabStop = false };
      originalToggle.LinkClicked += (sender,args) => {
        original.Visible = !original.Visible;
        originalToggle.Text = original.Visible ? "收起原草稿" : "查看原草稿";
        layout.RowStyles[5].Height = original.Visible ? 95 : 0;
      };
      layout.Controls.Add(originalToggle,0,4); layout.Controls.Add(original,0,5);
      status = new Label { Text = review.Notice, Dock = DockStyle.Fill, ForeColor = Color.DimGray }; layout.Controls.Add(status,0,6);
      preview.Controls.Add(layout);
      preview.KeyDown += (sender,args) => { if (args.KeyCode == Keys.Escape) { args.Handled = true; args.SuppressKeyPress = true; preview.Close(); } };
      preview.FormClosing += (sender,args) => {
        Cancel();
        if (review != null) { review.Enhanced = output.Text; review.Level = levels.SelectedIndex; review.Invalidate("预览已关闭，内容保留。重新打开后可继续编辑和复制；替换请重新强化当前草稿。"); }
      };
      preview.FormClosed += (sender,args) => { preview = null; };
      RefreshActions();
    }
    private void RefreshActions() {
      if (preview == null || preview.IsDisposed || review == null) return;
      if (apply != null && !apply.IsDisposed) apply.Enabled = !busy && review.CanApply;
      if (undo != null && !undo.IsDisposed) undo.Enabled = !busy && review.CanUndo;
      if (copy != null && !copy.IsDisposed) copy.Enabled = !String.IsNullOrWhiteSpace(review.Enhanced);
      if (generate != null && !generate.IsDisposed) generate.Text = String.IsNullOrWhiteSpace(review.Enhanced) ? "强化原草稿" : "再次强化预览";
    }
    private void SetBusy(bool value) {
      busy = value; generate.Enabled = !value; levels.Enabled = !value; cancel.Enabled = value;
      output.ReadOnly = value;
      RefreshActions();
    }
    private void Generate(string source) {
      if (busy) return;
      if (String.IsNullOrWhiteSpace(source)) { status.Text = "原草稿为空，请关闭预览后在 Codex 中输入草稿。"; return; }
      if (source.Length > 12000) { status.Text = "待强化文本超过 12000 字符。"; return; }
      long currentGeneration = requests.Begin();
      Log("model.starting");
      SetBusy(true); status.Text = "正在调用 Codex 默认模型，可随时取消……";
      var request = json.Serialize(new { executable = backendExe, text = source, level = new[] { "concise", "standard", "detailed" }[levels.SelectedIndex] });
      var start = new ProcessStartInfo(nodeExe, "\"" + worker + "\"") {
        UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
        StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = runtime
      };
      Task.Run(() => {
        Process process = null;
        try {
          process = new Process { StartInfo = start };
          lock (requestGate) {
            if (!requests.IsCurrent(currentGeneration)) return;
            process.Start(); requestProcess = process;
          }
          var bytes = Encoding.UTF8.GetBytes(request); process.StandardInput.BaseStream.Write(bytes,0,bytes.Length); process.StandardInput.Close();
          var errors = process.StandardError.ReadToEndAsync();
          string result = process.StandardOutput.ReadToEnd(); process.WaitForExit();
          var data = json.Deserialize<Dictionary<string,object>>(result);
          floating.BeginInvoke((Action)(() => {
            if (!requests.IsCurrent(currentGeneration) || preview == null || preview.IsDisposed) return;
            SetBusy(false);
            if (data.ContainsKey("ok") && (bool)data["ok"]) {
              output.Text = Convert.ToString(data["enhanced"]).Replace("\r\n","\n").Replace("\n",Environment.NewLine);
              Log("model.completed");
              review.Notice = "强化完成 · " + Convert.ToString(data["model"]) + "。请审阅后确认替换。";
              status.Text = review.Notice;
              ValidateSnapshot();
            } else { Log("model.failed"); review.Notice = "强化失败：" + Convert.ToString(data["error"]); status.Text = review.Notice; }
          }));
        } catch (Exception error) {
          if (!stopping && !floating.IsDisposed) floating.BeginInvoke((Action)(() => {
            if (!requests.IsCurrent(currentGeneration) || preview == null || preview.IsDisposed) return;
            SetBusy(false); review.Notice = "强化失败：" + error.Message; status.Text = review.Notice;
          }));
        } finally {
          lock (requestGate) { if (requestProcess == process) requestProcess = null; }
          if (process != null) process.Dispose();
        }
      });
    }
    private void Cancel() {
      if (busy) Log("model.cancelled");
      lock (requestGate) {
        requests.Cancel();
        try {
          if (requestProcess != null && !requestProcess.HasExited) {
            // Terminate only this request's process tree. Do not touch the desktop host.
            using (var killer = Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + requestProcess.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true })) killer.WaitForExit(3000);
          }
        } catch { }
        requestProcess = null;
      }
      if (preview != null && !preview.IsDisposed && output != null && !output.IsDisposed) {
        SetBusy(false); review.Notice = "已取消，现有预览保留。"; status.Text = review.Notice;
      }
    }
    private void Apply() {
      if (busy || review == null || !review.CanApply) return;
      ValidateSnapshot(); if (snapshot.Invalid) return;
      try {
        var editor = FindComposer(snapshot.Window);
        if (editor == null || !snapshot.Matches(snapshot.Window, editor.GetRuntimeId(), Read(editor))) { Invalidate("原草稿已改变，请重新强化。"); return; }
        ((ValuePattern)editor.GetCurrentPattern(ValuePattern.Pattern)).SetValue(output.Text);
        string actual = Read(editor);
        if (actual.Replace("\r\n","\n") != output.Text.Replace("\r\n","\n")) {
          Invalidate("宿主没有完整接受替换，请检查输入框。未发送任何内容。"); return;
        }
        review.Applied(actual); RefreshActions(); status.Text = review.Notice;
      } catch (Exception error) { Invalidate("回填未完成：" + error.Message + "。未发送任何内容。"); }
    }
    private void Undo() {
      if (busy || review == null || !review.CanUndo) return;
      ValidateSnapshot(); if (!review.CanUndo) return;
      try {
        var expected = review.Undo;
        var editor = FindComposer(expected.Window);
        if (editor == null || !expected.Matches(expected.Window, editor.GetRuntimeId(), Read(editor))) {
          Invalidate("输入框已改变，无法撤销覆盖新内容。"); return;
        }
        ((ValuePattern)editor.GetCurrentPattern(ValuePattern.Pattern)).SetValue(snapshot.Original);
        if (Read(editor).Replace("\r\n","\n") != snapshot.Original.Replace("\r\n","\n")) {
          Invalidate("宿主没有完整恢复原稿，请检查输入框。未发送任何内容。"); return;
        }
        review.Undone(); RefreshActions(); status.Text = review.Notice;
      } catch (Exception error) { Invalidate("撤销未完成：" + error.Message); }
    }
    private void Stop() {
      stopping = true; timer.Stop(); Cancel();
      if (preview != null) preview.Close(); floating.Close();
      try { File.Delete(Path.Combine(runtime, "overlay.pid")); } catch { }
      ExitThread();
    }
    public static void Run(string target, string backend, string node, string worker, string runtime) {
      bool created;
      using (var mutex = new Mutex(true, "Local\\PromptSparkCodexOverlay", out created)) {
        if (!created) return;
        try { Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); Native.SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        var app = new OverlayApp(target,backend,node,worker,runtime);
        Application.ThreadException += (sender,args) => {
          app.Log("ui.unhandled",args.Exception);
          app.openingPreview = false;
          if (app.preview != null && !app.preview.IsDisposed) {
            try { app.ShowPreview(); app.status.Text = "界面操作未完成。原草稿未改动，可以关闭后重试。"; } catch { }
          }
        };
        Application.Run(app);
      }
    }
    public static void SelfTest() {
      var s = new Snapshot { Window = new IntPtr(1), RuntimeId = new[] {1,2}, Original = "draft" };
      if (!s.Matches(new IntPtr(1),new[] {1,2},"draft")) throw new Exception("Snapshot match failed.");
      if (s.Matches(new IntPtr(2),new[] {1,2},"draft") || s.Matches(new IntPtr(1),new[] {1,3},"draft") || s.Matches(new IntPtr(1),new[] {1,2},"edited")) throw new Exception("Snapshot guard failed.");
      s.Invalid = true; if (s.Matches(new IntPtr(1),new[] {1,2},"draft")) throw new Exception("Invalidation failed.");
      Func<DraftReview> create = () => new DraftReview(new Snapshot { Window = new IntPtr(1), RuntimeId = new[] {1,2}, Original = "原草稿" }, 1);
      var review = create(); review.Enhanced = "用户编辑后的预览";
      if (!review.CanApply || review.CanUndo) throw new Exception("Review-only state failed.");
      review.Applied("已回填的文本");
      if (review.CanApply || !review.CanUndo || review.Source.Original != "原草稿") throw new Exception("Apply/undo state failed.");
      review.Enhanced = "继续编辑预览，不改撤销目标";
      review.Observe(new IntPtr(1), new[] {1,2}, "已回填的文本");
      if (!review.CanUndo || review.Undo.Original != "已回填的文本") throw new Exception("Editing preview must preserve undo target.");
      review.Undone();
      if (review.CanUndo || review.CanApply || review.Enhanced != "继续编辑预览，不改撤销目标") throw new Exception("Undo must preserve review text.");
      review = create(); review.Enhanced = "结果"; review.Applied("结果");
      review.Observe(new IntPtr(1),new[] {1,2},"后来写的新草稿");
      if (review.CanUndo || review.CanApply) throw new Exception("Undo overwrites new draft.");
      review = create(); review.Enhanced = "结果"; review.Applied("结果");
      review.Observe(new IntPtr(2),new[] {1,2},"结果");
      if (review.CanUndo) throw new Exception("Undo crosses window boundary.");
      review = create(); review.Enhanced = "保留手动编辑"; review.Level = 2;
      review.Invalidate("closed");
      if (review.CanApply || review.Enhanced != "保留手动编辑" || review.Level != 2) throw new Exception("Close lost preview or kept stale write authority.");
      var epoch = new RequestEpoch(); var first = epoch.Begin(); epoch.Cancel();
      if (epoch.IsCurrent(first)) throw new Exception("Cancelled result accepted.");
      var second = epoch.Begin();
      if (epoch.IsCurrent(first) || !epoch.IsCurrent(second)) throw new Exception("Late result replaced a newer request.");
      // Exercise the real WinForms controls without touching a desktop composer or model.
      using (var app = new OverlayApp(Path.Combine(Environment.SystemDirectory,"not-codex.exe"),"","","","",true)) {
        app.review = create(); app.BuildPreview(); app.preview.Handle.ToString();
        app.output.Text = "手动编辑的预览"; app.levels.SelectedIndex = 2;
        if (app.requestProcess != null || app.busy) throw new Exception("Opening preview requested a model.");
        if (!app.copy.Enabled || !app.apply.Enabled || app.undo.Enabled) throw new Exception("Preview actions not synchronized.");
        app.review.Applied("applied"); app.RefreshActions();
        if (!app.undo.Enabled || app.apply.Enabled) throw new Exception("Undo action not synchronized.");
        app.preview.Close();
        if (app.preview != null || app.review.Enhanced != "手动编辑的预览" || app.review.Level != 2) throw new Exception("Window close lost preview edits.");
        app.BuildPreview(); app.preview.Handle.ToString();
        if (app.output.Text != "手动编辑的预览" || app.levels.SelectedIndex != 2 || app.apply.Enabled || app.undo.Enabled || !app.copy.Enabled) throw new Exception("Reopen restored stale write authority or lost content.");
        app.ShowPreview();
        if (!app.preview.Visible || !Native.IsWindowVisible(app.preview.Handle)) throw new Exception("Preview Show did not expose a native window.");
        Native.ShowWindow(app.preview.Handle,0);
        if (Native.IsWindowVisible(app.preview.Handle)) throw new Exception("Test did not hide the native preview.");
        app.ShowPreview();
        if (!Native.IsWindowVisible(app.preview.Handle)) throw new Exception("Existing hidden preview was not restored.");
        Native.ShowWindow(app.preview.Handle,6);
        app.ShowPreview();
        if (!Native.IsWindowVisible(app.preview.Handle) || Native.IsIconic(app.preview.Handle)) throw new Exception("Existing minimized preview was not restored.");
        app.preview.Close(); app.floating.Close(); app.timer.Dispose();
      }
      Console.WriteLine("Overlay compiled; apply/undo, cancellation, edit retention and native preview show/hidden/minimized recovery passed. No model or composer writes.");
    }
    public static void Probe(string target) {
      foreach (var process in Process.GetProcesses()) {
        try {
          if (process.MainWindowHandle == IntPtr.Zero || !String.Equals(process.MainModule.FileName,target,StringComparison.OrdinalIgnoreCase)) continue;
          var editor = FindComposer(process.MainWindowHandle);
          Console.WriteLine(new JavaScriptSerializer().Serialize(new { matchedCodex = true, composerFound = editor != null,
            rectangle = editor == null ? "" : editor.Current.BoundingRectangle.ToString(),
            writable = editor != null && !((ValuePattern)editor.GetCurrentPattern(ValuePattern.Pattern)).Current.IsReadOnly }));
        } catch { } finally { process.Dispose(); }
      }
    }
  }
}
