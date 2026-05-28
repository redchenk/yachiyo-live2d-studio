using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Live2DStudioLauncher
{
    private const int DefaultPort = 3288;
    private const string Live2DPath = "/live2d-studio/";

    [STAThread]
    public static int Main(string[] args)
    {
        try
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;

            var repoRoot = FindRepoRoot(AppDomain.CurrentDomain.BaseDirectory);
            if (!EnsureBuilt(repoRoot))
            {
                MessageBox.Show(
                    "Missing dist/live2d-studio/index.html and automatic build failed.",
                    "Yachiyo Live2D Studio",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return 1;
            }

            var preferredPort = ParsePort(args, DefaultPort);
            var port = FindAvailablePort(preferredPort);
            using (var server = new LocalStudioServer(repoRoot, port, Live2DPath))
            {
                server.Start();
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new StudioWindow(server.Url, repoRoot));
            }

            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                ex.ToString(),
                "Yachiyo Live2D Studio",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }

    private static string FindRepoRoot(string baseDir)
    {
        var directory = new DirectoryInfo(baseDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        for (var depth = 0; depth < 8 && directory != null; depth++)
        {
            var fullName = directory.FullName;
            if (Directory.Exists(Path.Combine(fullName, "live2d-studio")) &&
                Directory.Exists(Path.Combine(fullName, "models")) &&
                Directory.Exists(Path.Combine(fullName, "lib")))
            {
                return fullName;
            }

            directory = directory.Parent;
        }

        return baseDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private static int ParsePort(string[] args, int fallback)
    {
        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i] ?? string.Empty;
            if (arg.StartsWith("--port=", StringComparison.OrdinalIgnoreCase))
            {
                int value;
                if (int.TryParse(arg.Substring("--port=".Length), out value))
                {
                    return value;
                }
            }

            if (string.Equals(arg, "--port", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
            {
                int value;
                if (int.TryParse(args[i + 1], out value))
                {
                    return value;
                }
            }
        }

        return fallback;
    }

    private static int FindAvailablePort(int preferredPort)
    {
        for (var port = preferredPort; port < preferredPort + 32 && port <= 65535; port++)
        {
            TcpListener probe = null;
            try
            {
                probe = new TcpListener(IPAddress.Loopback, port);
                probe.Start();
                return port;
            }
            catch (SocketException)
            {
                // try next port
            }
            finally
            {
                if (probe != null)
                {
                    probe.Stop();
                }
            }
        }

        throw new InvalidOperationException("Unable to find a free port near " + preferredPort + ".");
    }

    private static bool EnsureBuilt(string repoRoot)
    {
        var builtIndex = Path.Combine(repoRoot, "dist", "live2d-studio", "index.html");
        if (File.Exists(builtIndex))
        {
            return true;
        }

        var nodeDir = FindNodeDirectory(repoRoot);
        if (string.IsNullOrEmpty(nodeDir))
        {
            return false;
        }

        var build = new ProcessStartInfo
        {
            FileName = Path.Combine(Environment.SystemDirectory, "cmd.exe"),
            Arguments = "/c npm run build:live2d-studio",
            WorkingDirectory = repoRoot,
            UseShellExecute = false,
            CreateNoWindow = false
        };
        build.EnvironmentVariables["PATH"] = nodeDir + Path.PathSeparator + build.EnvironmentVariables["PATH"];

        using (var process = Process.Start(build))
        {
            process.WaitForExit();
            if (process.ExitCode != 0)
            {
                return false;
            }
        }

        return File.Exists(builtIndex);
    }

    private static string FindNodeDirectory(string repoRoot)
    {
        var candidates = new[]
        {
            Path.GetFullPath(Path.Combine(repoRoot, "tools", "node-v22.11.0-win-x64")),
            Path.GetFullPath(Path.Combine(repoRoot, "..", "tools", "node-v22.11.0-win-x64")),
            Path.GetFullPath(Path.Combine(repoRoot, "..", ".codex_tmp", "node-v20.19.0-win-x64")),
            Path.GetFullPath(Path.Combine(repoRoot, "..", ".codex_tmp", "node-v22.11.0-win-x64"))
        };

        foreach (var candidate in candidates)
        {
            if (File.Exists(Path.Combine(candidate, "node.exe")) && File.Exists(Path.Combine(candidate, "npm.cmd")))
            {
                return candidate;
            }
        }

        var pathValue = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var pathEntry in pathValue.Split(new[] { Path.PathSeparator }, StringSplitOptions.RemoveEmptyEntries))
        {
            var trimmed = pathEntry.Trim('"');
            if (File.Exists(Path.Combine(trimmed, "node.exe")) && File.Exists(Path.Combine(trimmed, "npm.cmd")))
            {
                return trimmed;
            }
        }

        return string.Empty;
    }
}

internal sealed class StudioWindow : Form
{
    private readonly string url;
    private readonly string repoRoot;
    private readonly WebView2 webView;
    private readonly Label errorLabel;

    public StudioWindow(string url, string repoRoot)
    {
        this.url = url;
        this.repoRoot = repoRoot;

        Text = "Yachiyo Live2D Studio";
        StartPosition = FormStartPosition.CenterScreen;
        Width = 1360;
        Height = 860;
        MinimumSize = new Size(960, 640);
        BackColor = Color.FromArgb(8, 10, 18);

        var iconPath = Path.Combine(repoRoot, "favicon.ico");
        if (File.Exists(iconPath))
        {
            Icon = new Icon(iconPath);
        }

        errorLabel = new Label
        {
            Dock = DockStyle.Fill,
            ForeColor = Color.White,
            BackColor = Color.FromArgb(8, 10, 18),
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI", 10),
            Visible = false
        };

        webView = new WebView2
        {
            Dock = DockStyle.Fill,
            CreationProperties = new CoreWebView2CreationProperties
            {
                UserDataFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "YachiyoLive2DStudio",
                    "WebView2")
            }
        };

        Controls.Add(webView);
        Controls.Add(errorLabel);

        Shown += OnShown;
    }

    private async void OnShown(object sender, EventArgs e)
    {
        try
        {
            await webView.EnsureCoreWebView2Async(null);
            webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            webView.CoreWebView2.Navigate(url);
        }
        catch (Exception ex)
        {
            webView.Visible = false;
            errorLabel.Text = "WebView2 failed to start.\r\n\r\n" + ex.Message;
            errorLabel.Visible = true;
        }
    }
}

internal sealed class LocalStudioServer : IDisposable
{
    private readonly string repoRoot;
    private readonly int port;
    private readonly string live2DPath;
    private readonly CancellationTokenSource shutdown = new CancellationTokenSource();
    private TcpListener listener;
    private Thread worker;

    public LocalStudioServer(string repoRoot, int port, string live2DPath)
    {
        this.repoRoot = repoRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        this.port = port;
        this.live2DPath = live2DPath;
    }

    public string Url
    {
        get { return "http://127.0.0.1:" + port + live2DPath; }
    }

    public void Start()
    {
        listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();
        worker = new Thread(RunServer)
        {
            IsBackground = true,
            Name = "Yachiyo Live2D static server"
        };
        worker.Start();
    }

    public void Dispose()
    {
        shutdown.Cancel();
        var current = listener;
        listener = null;
        if (current != null)
        {
            try { current.Stop(); }
            catch { }
        }
    }

    private void RunServer()
    {
        while (!shutdown.IsCancellationRequested)
        {
            TcpClient client = null;
            try
            {
                client = listener.AcceptTcpClient();
            }
            catch (SocketException)
            {
                if (shutdown.IsCancellationRequested) break;
            }
            catch (ObjectDisposedException)
            {
                break;
            }

            if (client != null)
            {
                ThreadPool.QueueUserWorkItem(_ => HandleClient(client));
            }
        }
    }

    private void HandleClient(TcpClient client)
    {
        using (client)
        using (var stream = client.GetStream())
        {
            var request = ReadRequest(stream);
            if (request == null)
            {
                return;
            }

            var method = request.Method.ToUpperInvariant();
            var path = request.Path;
            var queryIndex = path.IndexOf('?');
            if (queryIndex >= 0)
            {
                path = path.Substring(0, queryIndex);
            }
            path = Uri.UnescapeDataString(path);

            if (method == "POST" && string.Equals(path, "/api/chat", StringComparison.OrdinalIgnoreCase))
            {
                WriteApiResponse(stream, DesktopApiProxy.Chat(request.Body));
                return;
            }

            if (method == "POST" && string.Equals(path, "/api/chat/stream", StringComparison.OrdinalIgnoreCase))
            {
                WriteChatStreamResponse(stream, request.Body);
                return;
            }

            if (method == "POST" && string.Equals(path, "/api/tts", StringComparison.OrdinalIgnoreCase))
            {
                WriteApiResponse(stream, DesktopApiProxy.Tts(request.Body));
                return;
            }

            if (method != "GET" && method != "HEAD")
            {
                WritePlainResponse(stream, 405, "Method Not Allowed", "text/plain; charset=utf-8", "Method Not Allowed", false);
                return;
            }

            if (path == "/" || string.IsNullOrEmpty(path))
            {
                WriteRedirect(stream, live2DPath);
                return;
            }

            if (string.Equals(path, "/live2d-studio", StringComparison.OrdinalIgnoreCase))
            {
                WriteRedirect(stream, live2DPath);
                return;
            }

            var physicalPath = ResolvePhysicalPath(path);
            if (physicalPath == null)
            {
                WritePlainResponse(stream, 404, "Not Found", "text/plain; charset=utf-8", "Not Found", false);
                return;
            }

            if (!File.Exists(physicalPath))
            {
                if (IsLive2DRoute(path))
                {
                    physicalPath = Path.Combine(repoRoot, "dist", "live2d-studio", "index.html");
                }
                else if (Directory.Exists(physicalPath))
                {
                    var directoryIndex = Path.Combine(physicalPath, "index.html");
                    if (File.Exists(directoryIndex))
                    {
                        physicalPath = directoryIndex;
                    }
                }
            }

            if (!File.Exists(physicalPath))
            {
                WritePlainResponse(stream, 404, "Not Found", "text/plain; charset=utf-8", "Not Found", false);
                return;
            }

            WriteFileResponse(stream, physicalPath, method == "HEAD");
        }
    }

    private static StudioRequest ReadRequest(NetworkStream stream)
    {
        var headerBytes = new MemoryStream();
        var buffer = new byte[8192];
        var headerEnd = -1;
        var maxHeaderBytes = 65536;

        while (headerEnd < 0 && headerBytes.Length < maxHeaderBytes)
        {
            var read = stream.Read(buffer, 0, buffer.Length);
            if (read <= 0)
            {
                return null;
            }
            headerBytes.Write(buffer, 0, read);
            headerEnd = FindHeaderEnd(headerBytes.GetBuffer(), (int)headerBytes.Length);
        }

        if (headerEnd < 0)
        {
            return null;
        }

        var allBytes = headerBytes.ToArray();
        var headerText = Encoding.ASCII.GetString(allBytes, 0, headerEnd);
        var lines = headerText.Split(new[] { "\r\n" }, StringSplitOptions.None);
        if (lines.Length == 0)
        {
            return null;
        }

        var firstLine = lines[0].Split(' ');
        if (firstLine.Length < 2)
        {
            return null;
        }

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 1; i < lines.Length; i++)
        {
            var separator = lines[i].IndexOf(':');
            if (separator <= 0) continue;
            headers[lines[i].Substring(0, separator).Trim()] = lines[i].Substring(separator + 1).Trim();
        }

        var contentLength = 0;
        int.TryParse(headers.ContainsKey("Content-Length") ? headers["Content-Length"] : "0", out contentLength);
        if (contentLength < 0 || contentLength > 16 * 1024 * 1024)
        {
            return null;
        }

        var body = new byte[contentLength];
        var bodyOffset = headerEnd + 4;
        var alreadyRead = Math.Min(contentLength, Math.Max(0, allBytes.Length - bodyOffset));
        if (alreadyRead > 0)
        {
            Buffer.BlockCopy(allBytes, bodyOffset, body, 0, alreadyRead);
        }

        while (alreadyRead < contentLength)
        {
            var read = stream.Read(body, alreadyRead, contentLength - alreadyRead);
            if (read <= 0) break;
            alreadyRead += read;
        }

        return new StudioRequest
        {
            Method = firstLine[0].Trim(),
            Path = firstLine[1].Trim(),
            Headers = headers,
            Body = body
        };
    }

    private static int FindHeaderEnd(byte[] bytes, int length)
    {
        for (var i = 3; i < length; i++)
        {
            if (bytes[i - 3] == 13 && bytes[i - 2] == 10 && bytes[i - 1] == 13 && bytes[i] == 10)
            {
                return i - 3;
            }
        }

        return -1;
    }

    private bool IsLive2DRoute(string path)
    {
        return path.StartsWith("/live2d-studio/", StringComparison.OrdinalIgnoreCase);
    }

    private string ResolvePhysicalPath(string requestPath)
    {
        var safePath = requestPath.TrimStart('/');
        if (safePath.StartsWith("live2d-studio/", StringComparison.OrdinalIgnoreCase))
        {
            safePath = "dist/" + safePath;
        }

        var combined = Path.GetFullPath(Path.Combine(repoRoot, safePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!combined.StartsWith(repoRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(combined, repoRoot, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return combined;
    }

    private static void WriteRedirect(NetworkStream stream, string location)
    {
        var headers = new StringBuilder();
        headers.Append("HTTP/1.1 302 Found\r\n");
        headers.Append("Location: ").Append(location).Append("\r\n");
        headers.Append("Cache-Control: no-store\r\n");
        headers.Append("Connection: close\r\n\r\n");
        WriteBytes(stream, Encoding.ASCII.GetBytes(headers.ToString()));
    }

    private static void WriteFileResponse(NetworkStream stream, string filePath, bool headOnly)
    {
        var bytes = File.ReadAllBytes(filePath);
        var headers = new StringBuilder();
        headers.Append("HTTP/1.1 200 OK\r\n");
        headers.Append("Content-Type: ").Append(GetContentType(filePath)).Append("\r\n");
        headers.Append("Content-Length: ").Append(bytes.Length).Append("\r\n");
        headers.Append("Cache-Control: ").Append(GetCacheControl(filePath)).Append("\r\n");
        headers.Append("Connection: close\r\n\r\n");

        WriteBytes(stream, Encoding.ASCII.GetBytes(headers.ToString()));
        if (!headOnly)
        {
            WriteBytes(stream, bytes);
        }
    }

    private static void WriteApiResponse(NetworkStream stream, StudioApiResponse response)
    {
        var body = response.Body ?? new byte[0];
        var headers = new StringBuilder();
        headers.Append("HTTP/1.1 ").Append(response.StatusCode).Append(' ').Append(response.StatusText).Append("\r\n");
        headers.Append("Content-Type: ").Append(response.ContentType).Append("\r\n");
        headers.Append("Content-Length: ").Append(body.Length).Append("\r\n");
        headers.Append("Cache-Control: no-store\r\n");
        headers.Append("Connection: close\r\n\r\n");
        WriteBytes(stream, Encoding.ASCII.GetBytes(headers.ToString()));
        WriteBytes(stream, body);
    }

    private static void WriteChatStreamResponse(NetworkStream stream, byte[] body)
    {
        var headers = new StringBuilder();
        headers.Append("HTTP/1.1 200 OK\r\n");
        headers.Append("Content-Type: text/event-stream; charset=utf-8\r\n");
        headers.Append("Cache-Control: no-store\r\n");
        headers.Append("Connection: close\r\n\r\n");
        WriteBytes(stream, Encoding.ASCII.GetBytes(headers.ToString()));
        DesktopApiProxy.ChatStream(body, bytes => WriteBytes(stream, bytes));
    }

    private static void WritePlainResponse(NetworkStream stream, int statusCode, string statusText, string contentType, string body, bool headOnly)
    {
        var payload = Encoding.UTF8.GetBytes(body ?? string.Empty);
        var headers = new StringBuilder();
        headers.Append("HTTP/1.1 ").Append(statusCode).Append(' ').Append(statusText).Append("\r\n");
        headers.Append("Content-Type: ").Append(contentType).Append("\r\n");
        headers.Append("Content-Length: ").Append(payload.Length).Append("\r\n");
        headers.Append("Cache-Control: no-store\r\n");
        headers.Append("Connection: close\r\n\r\n");
        WriteBytes(stream, Encoding.ASCII.GetBytes(headers.ToString()));
        if (!headOnly)
        {
            WriteBytes(stream, payload);
        }
    }

    private static void WriteBytes(NetworkStream stream, byte[] bytes)
    {
        stream.Write(bytes, 0, bytes.Length);
        stream.Flush();
    }

    private static string GetContentType(string filePath)
    {
        var extension = Path.GetExtension(filePath).ToLowerInvariant();
        switch (extension)
        {
            case ".html":
            case ".htm":
                return "text/html; charset=utf-8";
            case ".js":
            case ".mjs":
                return "application/javascript; charset=utf-8";
            case ".css":
                return "text/css; charset=utf-8";
            case ".json":
                return "application/json; charset=utf-8";
            case ".svg":
                return "image/svg+xml";
            case ".png":
                return "image/png";
            case ".jpg":
            case ".jpeg":
                return "image/jpeg";
            case ".gif":
                return "image/gif";
            case ".webp":
                return "image/webp";
            case ".ico":
                return "image/x-icon";
            case ".woff":
                return "font/woff";
            case ".woff2":
                return "font/woff2";
            case ".moc3":
            case ".bin":
                return "application/octet-stream";
            default:
                return "application/octet-stream";
        }
    }

    private static string GetCacheControl(string filePath)
    {
        var extension = Path.GetExtension(filePath).ToLowerInvariant();
        switch (extension)
        {
            case ".html":
            case ".js":
            case ".json":
            case ".moc3":
            case ".png":
            case ".webp":
                return "no-store";
            default:
                return "public, max-age=3600";
        }
    }
}

internal sealed class StudioRequest
{
    public string Method;
    public string Path;
    public Dictionary<string, string> Headers;
    public byte[] Body;
}

internal sealed class StudioApiResponse
{
    public int StatusCode;
    public string StatusText;
    public string ContentType;
    public byte[] Body;
}

internal static class DesktopApiProxy
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

    public static StudioApiResponse Chat(byte[] body)
    {
        try
        {
            var input = ParseObject(body);
            var message = GetString(input, "message");
            var apiKey = GetString(input, "apiKey");
            var apiUrl = NormalizeChatUrl(GetString(input, "apiUrl"), GetString(input, "model"));
            var model = GetString(input, "model");
            var systemPrompt = GetString(input, "systemPrompt");

            if (string.IsNullOrWhiteSpace(message))
            {
                return JsonError(400, "Message is required.");
            }
            if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(apiUrl))
            {
                return JsonError(400, "LLM API URL and API Key are required.");
            }
            ValidateRemoteOrLoopbackUrl(apiUrl);

            var payload = BuildChatPayload(input, apiUrl, model, systemPrompt, message);
            var responseText = PostJson(apiUrl, payload, ChatHeaders(apiUrl, apiKey));
            var providerData = DeserializeObject(responseText);
            var reply = PickReply(providerData);
            if (string.IsNullOrWhiteSpace(reply))
            {
                reply = responseText;
            }

            return JsonOk(new Dictionary<string, object>
            {
                { "success", true },
                { "data", new Dictionary<string, object> { { "reply", reply }, { "model", model } } }
            });
        }
        catch (WebException ex)
        {
            return JsonError(GetStatusCode(ex, 502), ReadWebException(ex));
        }
        catch (Exception ex)
        {
            return JsonError(500, ex.Message);
        }
    }

    public static void ChatStream(byte[] body, Action<byte[]> write)
    {
        try
        {
            var input = ParseObject(body);
            var message = GetString(input, "message");
            var apiKey = GetString(input, "apiKey");
            var apiUrl = NormalizeChatUrl(GetString(input, "apiUrl"), GetString(input, "model"));
            var model = GetString(input, "model");
            var systemPrompt = GetString(input, "systemPrompt");

            if (string.IsNullOrWhiteSpace(message))
            {
                WriteSseEvent(write, "error", Json.Serialize(new Dictionary<string, object> { { "message", "Message is required." } }));
                return;
            }
            if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(apiUrl))
            {
                WriteSseEvent(write, "error", Json.Serialize(new Dictionary<string, object> { { "message", "LLM API URL and API Key are required." } }));
                return;
            }
            ValidateRemoteOrLoopbackUrl(apiUrl);

            var payload = BuildChatPayload(input, apiUrl, model, systemPrompt, message);
            payload["stream"] = true;
            PostJsonStream(apiUrl, payload, ChatHeaders(apiUrl, apiKey), write);
        }
        catch (WebException ex)
        {
            WriteSseEvent(write, "error", Json.Serialize(new Dictionary<string, object>
            {
                { "message", ReadWebException(ex) },
                { "status", GetStatusCode(ex, 502) }
            }));
        }
        catch (Exception ex)
        {
            WriteSseEvent(write, "error", Json.Serialize(new Dictionary<string, object> { { "message", ex.Message } }));
        }
    }

    public static StudioApiResponse Tts(byte[] body)
    {
        try
        {
            var input = ParseObject(body);
            var provider = GetString(input, "provider");
            if (string.IsNullOrEmpty(provider))
            {
                provider = "gpt-sovits";
            }
            provider = provider.ToLowerInvariant();

            if (provider == "gpt-sovits")
            {
                return GptSovitsTts(input);
            }
            if (provider == "mimo" || RegexContains(GetString(input, "apiUrl"), @"xiaomimimo|token-plan-cn"))
            {
                return MimoTts(input);
            }

            return OpenAiTts(input);
        }
        catch (WebException ex)
        {
            return JsonError(GetStatusCode(ex, 502), ReadWebException(ex));
        }
        catch (Exception ex)
        {
            return JsonError(500, ex.Message);
        }
    }

    private static Dictionary<string, object> ParseObject(byte[] body)
    {
        var text = Encoding.UTF8.GetString(body ?? new byte[0]);
        return DeserializeObject(text);
    }

    private static Dictionary<string, object> DeserializeObject(string text)
    {
        var data = Json.DeserializeObject(text ?? "{}") as Dictionary<string, object>;
        return data ?? new Dictionary<string, object>();
    }

    private static string GetString(Dictionary<string, object> data, string key)
    {
        object value;
        return data != null && data.TryGetValue(key, out value) && value != null ? Convert.ToString(value).Trim() : string.Empty;
    }

    private static object[] GetArray(Dictionary<string, object> data, string key)
    {
        object value;
        return data != null && data.TryGetValue(key, out value) ? value as object[] : null;
    }

    private static Dictionary<string, object> GetObject(Dictionary<string, object> data, string key)
    {
        object value;
        return data != null && data.TryGetValue(key, out value) ? value as Dictionary<string, object> : null;
    }

    private static double GetDouble(Dictionary<string, object> data, string key, double fallback, double min, double max)
    {
        object value;
        if (data == null || !data.TryGetValue(key, out value) || value == null)
        {
            return fallback;
        }
        double numeric;
        if (!double.TryParse(Convert.ToString(value), out numeric))
        {
            return fallback;
        }
        if (numeric < min) return min;
        if (numeric > max) return max;
        return numeric;
    }

    private static string NormalizeChatUrl(string apiUrl, string model)
    {
        var url = (apiUrl ?? string.Empty).Trim();
        if (RegexContains(url, @"(api\.openai\.com|api\.x\.ai)/v1/?$"))
        {
            return url.TrimEnd('/') + "/responses";
        }
        if (RegexContains(url, @"(xiaomimimo\.com|token-plan-cn\.xiaomimimo\.com)/v1/?$"))
        {
            return url.TrimEnd('/') + "/chat/completions";
        }
        if (RegexContains(url + " " + model, @"deepseek|dashscope|aliyuncs|openai|openrouter|moonshot|bigmodel|zhipu|siliconflow|volces|ark|groq|mistral|together|perplexity|x\.ai|generativelanguage|xiaomimimo|token-plan-cn") &&
            !RegexContains(url, @"/(chat/completions|responses)/?$"))
        {
            return url.TrimEnd('/') + "/chat/completions";
        }
        return url;
    }

    private static string NormalizeMimoTtsUrl(string apiUrl)
    {
        var url = (apiUrl ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(url))
        {
            return "https://api.xiaomimimo.com/v1/chat/completions";
        }
        if (RegexContains(url, @"(xiaomimimo\.com|token-plan-cn\.xiaomimimo\.com)/v1/?$"))
        {
            return url.TrimEnd('/') + "/chat/completions";
        }
        return url;
    }

    private static bool RegexContains(string value, string pattern)
    {
        return System.Text.RegularExpressions.Regex.IsMatch(value ?? string.Empty, pattern, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    }

    private static void ValidateRemoteOrLoopbackUrl(string url)
    {
        Uri parsed;
        if (!Uri.TryCreate(url, UriKind.Absolute, out parsed))
        {
            throw new InvalidOperationException("Invalid API URL.");
        }
        if (parsed.Scheme == Uri.UriSchemeHttps)
        {
            return;
        }
        if (parsed.Scheme == Uri.UriSchemeHttp && IsLoopbackHost(parsed.Host))
        {
            return;
        }
        throw new InvalidOperationException("Only HTTPS remote API URLs or loopback HTTP URLs are allowed.");
    }

    private static bool IsLoopbackHost(string host)
    {
        return string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(host, "::1", StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeGptSovitsLang(string value, string fallback)
    {
        var raw = (value ?? string.Empty).Trim().ToLowerInvariant().Replace("_", "-");
        if (raw == "cn" || raw == "zh-cn" || raw == "chinese" || raw == "mandarin") return "zh";
        if (raw == "jp" || raw == "jpn" || raw == "japanese") return "ja";
        if (raw == "english") return "en";
        if (raw == "korean") return "ko";
        if (raw == "auto") return "auto";
        if (raw == "zh" || raw == "ja" || raw == "en" || raw == "ko" || raw == "yue") return raw;
        return fallback;
    }

    private static string DetectTextLang(string text)
    {
        foreach (var ch in text ?? string.Empty)
        {
            if (ch >= 0x3040 && ch <= 0x30ff) return "ja";
            if (ch >= 0xac00 && ch <= 0xd7af) return "ko";
            if (ch >= 0x4e00 && ch <= 0x9fff) return "zh";
        }
        return "en";
    }

    private static string TtsEmotionInstruction(Dictionary<string, object> input)
    {
        var emotion = GetString(input, "emotion");
        var speechStyle = GetObject(input, "speechStyle");
        var pause = GetString(speechStyle, "pause");
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(emotion))
        {
            parts.Add("Use a " + emotion + " emotional delivery.");
        }
        if (!string.IsNullOrWhiteSpace(pause))
        {
            parts.Add("Timing style: " + pause + ".");
        }
        return parts.Count == 0 ? string.Empty : " " + string.Join(" ", parts);
    }

    private static string TtsReadInstruction(string text, string textLang, Dictionary<string, object> input)
    {
        var lang = NormalizeGptSovitsLang(textLang, "auto");
        if (lang == "auto")
        {
            lang = DetectTextLang(text);
        }
        var emotion = TtsEmotionInstruction(input);
        if (lang == "ja")
        {
            return "Read only the following Japanese text in a soft, natural voice. Do not read explanations, translations, action cues, or stage directions." + emotion;
        }
        if (lang == "ko")
        {
            return "Read only the following Korean text in a soft, natural voice. Do not read explanations, translations, action cues, or stage directions." + emotion;
        }
        if (lang == "zh" || lang == "yue")
        {
            return "Read only the following Chinese text in a soft, natural voice. Do not read explanations, translations, action cues, or stage directions." + emotion;
        }
        return "Read only the following English text in a soft, natural voice. Do not read explanations, translations, action cues, or stage directions." + emotion;
    }

    private static Dictionary<string, string> ChatHeaders(string apiUrl, string apiKey)
    {
        var headers = new Dictionary<string, string> { { "Authorization", "Bearer " + apiKey } };
        if (RegexContains(apiUrl, @"openrouter\.ai/api/v1/chat/completions/?$"))
        {
            headers["HTTP-Referer"] = "http://127.0.0.1";
            headers["X-OpenRouter-Title"] = "Yachiyo Live2D Studio";
        }
        return headers;
    }

    private static Dictionary<string, object> BuildChatPayload(Dictionary<string, object> input, string apiUrl, string model, string systemPrompt, string message)
    {
        var maxTokens = (int)Math.Round(GetDouble(input, "maxTokens", 1000, 64, 1000));
        var history = new List<object>();
        var rawHistory = GetArray(input, "conversation");
        if (rawHistory != null)
        {
            foreach (var item in rawHistory)
            {
                var line = item as Dictionary<string, object>;
                if (line == null) continue;
                var role = GetString(line, "role");
                if (role != "user" && role != "assistant") continue;
                history.Add(new Dictionary<string, object> { { "role", role }, { "content", GetString(line, "content") } });
            }
        }

        if (RegexContains(apiUrl, @"(api\.openai\.com|api\.x\.ai)/v1/responses/?$"))
        {
            var inputList = new List<object>();
            foreach (var item in history)
            {
                inputList.Add(item);
            }
            inputList.Add(new Dictionary<string, object> { { "role", "user" }, { "content", message } });
            return new Dictionary<string, object>
            {
                { "model", string.IsNullOrWhiteSpace(model) ? "gpt-4o-mini" : model },
                { "instructions", systemPrompt },
                { "input", inputList },
                { "max_output_tokens", maxTokens }
            };
        }

        var messages = new List<object>();
        if (!string.IsNullOrWhiteSpace(systemPrompt))
        {
            messages.Add(new Dictionary<string, object> { { "role", "system" }, { "content", systemPrompt } });
        }
        foreach (var item in history)
        {
            messages.Add(item);
        }
        messages.Add(new Dictionary<string, object> { { "role", "user" }, { "content", message } });

        return new Dictionary<string, object>
        {
            { "model", string.IsNullOrWhiteSpace(model) ? "gpt-4o-mini" : model },
            { "messages", messages },
            { "temperature", RegexContains(apiUrl + " " + model, @"moonshot|kimi") ? 1 : 0.4 },
            { "max_tokens", maxTokens },
            { "stream", false }
        };
    }

    private static StudioApiResponse GptSovitsTts(Dictionary<string, object> input)
    {
        var text = GetString(input, "text");
        if (string.IsNullOrWhiteSpace(text))
        {
            return JsonError(400, "TTS text is required.");
        }

        var apiUrl = GetString(input, "apiUrl");
        if (string.IsNullOrWhiteSpace(apiUrl))
        {
            apiUrl = "http://127.0.0.1:9880/tts";
        }
        Uri parsed;
        if (!Uri.TryCreate(apiUrl, UriKind.Absolute, out parsed) || parsed.Scheme != Uri.UriSchemeHttp || !IsLoopbackHost(parsed.Host))
        {
            return JsonError(400, "GPT-SoVITS proxy only allows loopback HTTP URLs.");
        }

        TryLoadGptSovitsWeight(parsed, "/set_gpt_weights", GetString(input, "gptWeightPath"));
        TryLoadGptSovitsWeight(parsed, "/set_sovits_weights", GetString(input, "sovitsWeightPath"));

        var textLang = NormalizeGptSovitsLang(GetString(input, "textLang"), "auto");
        if (textLang == "auto")
        {
            textLang = DetectTextLang(text);
        }

        var query = new Dictionary<string, string>
        {
            { "text", text },
            { "text_lang", textLang },
            { "ref_audio_path", GetString(input, "refAudioPath") },
            { "prompt_text", GetString(input, "promptText") },
            { "prompt_lang", NormalizeGptSovitsLang(GetString(input, "promptLang"), "ja") },
            { "text_split_method", text.Length <= 4 ? "cut0" : "cut5" },
            { "batch_size", "1" },
            { "media_type", "wav" },
            { "streaming_mode", "false" },
            { "parallel_infer", "true" },
            { "_", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString() }
        };

        var builder = new UriBuilder(parsed);
        builder.Query = BuildQuery(query);
        var provider = GetBytes(builder.ToString(), null);
        return new StudioApiResponse
        {
            StatusCode = 200,
            StatusText = "OK",
            ContentType = string.IsNullOrWhiteSpace(provider.ContentType) ? "audio/wav" : provider.ContentType,
            Body = provider.Body
        };
    }

    private static StudioApiResponse MimoTts(Dictionary<string, object> input)
    {
        var text = GetString(input, "text");
        var apiKey = GetString(input, "apiKey");
        var apiUrl = NormalizeMimoTtsUrl(GetString(input, "apiUrl"));
        ValidateRemoteOrLoopbackUrl(apiUrl);
        if (string.IsNullOrWhiteSpace(text) || string.IsNullOrWhiteSpace(apiKey))
        {
            return JsonError(400, "MiMo TTS text and API Key are required.");
        }

        var model = GetString(input, "model");
        if (string.IsNullOrWhiteSpace(model))
        {
            model = "mimo-v2.5-tts";
        }
        var voice = GetString(input, "voice");
        if (string.IsNullOrWhiteSpace(voice))
        {
            voice = "mimo_default";
        }

        var payload = new Dictionary<string, object>
        {
            { "model", model },
            { "messages", new object[]
                {
                    new Dictionary<string, object> { { "role", "user" }, { "content", TtsReadInstruction(text, GetString(input, "textLang"), input) } },
                    new Dictionary<string, object> { { "role", "assistant" }, { "content", text } }
                }
            },
            { "modalities", new object[] { "audio" } },
            { "audio", new Dictionary<string, object> { { "format", "wav" }, { "voice", voice } } }
        };

        var provider = PostBytes(apiUrl, Json.Serialize(payload), new Dictionary<string, string> { { "api-key", apiKey } });
        if (!string.IsNullOrWhiteSpace(provider.ContentType) &&
            provider.ContentType.StartsWith("audio/", StringComparison.OrdinalIgnoreCase))
        {
            return new StudioApiResponse
            {
                StatusCode = 200,
                StatusText = "OK",
                ContentType = provider.ContentType,
                Body = provider.Body
            };
        }

        var responseText = Encoding.UTF8.GetString(provider.Body);
        var audioPayload = PickAudioBase64(DeserializeObject(responseText));
        if (string.IsNullOrWhiteSpace(audioPayload))
        {
            throw new InvalidOperationException("Unable to parse MiMo TTS audio data.");
        }

        return new StudioApiResponse
        {
            StatusCode = 200,
            StatusText = "OK",
            ContentType = "audio/wav",
            Body = DecodeAudioPayload(audioPayload)
        };
    }

    private static StudioApiResponse OpenAiTts(Dictionary<string, object> input)
    {
        var text = GetString(input, "text");
        var apiKey = GetString(input, "apiKey");
        var apiUrl = GetString(input, "apiUrl");
        if (string.IsNullOrWhiteSpace(apiUrl))
        {
            apiUrl = "https://api.openai.com/v1/audio/speech";
        }
        ValidateRemoteOrLoopbackUrl(apiUrl);
        if (string.IsNullOrWhiteSpace(text) || string.IsNullOrWhiteSpace(apiKey))
        {
            return JsonError(400, "TTS text and API Key are required.");
        }

        var speechStyle = GetObject(input, "speechStyle");
        var speed = GetDouble(speechStyle, "speed", 1.0, 0.75, 1.25);
        var payload = new Dictionary<string, object>
        {
            { "model", GetString(input, "model") == string.Empty ? "tts-1" : GetString(input, "model") },
            { "input", text },
            { "voice", GetString(input, "voice") == string.Empty ? "alloy" : GetString(input, "voice") },
            { "response_format", "mp3" },
            { "speed", speed }
        };

        var provider = PostBytes(apiUrl, Json.Serialize(payload), new Dictionary<string, string> { { "Authorization", "Bearer " + apiKey } });
        return new StudioApiResponse
        {
            StatusCode = 200,
            StatusText = "OK",
            ContentType = string.IsNullOrWhiteSpace(provider.ContentType) ? "audio/mpeg" : provider.ContentType,
            Body = provider.Body
        };
    }

    private static void TryLoadGptSovitsWeight(Uri baseUri, string path, string weightPath)
    {
        if (string.IsNullOrWhiteSpace(weightPath))
        {
            return;
        }

        try
        {
            var builder = new UriBuilder(baseUri);
            builder.Path = path;
            builder.Query = BuildQuery(new Dictionary<string, string> { { "weights_path", weightPath } });
            GetBytes(builder.ToString(), null);
        }
        catch
        {
            // The browser implementation treats these endpoints as best-effort.
        }
    }

    private static string BuildQuery(Dictionary<string, string> values)
    {
        var parts = new List<string>();
        foreach (var pair in values)
        {
            if (pair.Value == null) continue;
            parts.Add(Uri.EscapeDataString(pair.Key) + "=" + Uri.EscapeDataString(pair.Value));
        }
        return string.Join("&", parts);
    }

    private static string PickAudioBase64(Dictionary<string, object> data)
    {
        var choices = GetArray(data, "choices");
        if (choices != null && choices.Length > 0)
        {
            var first = choices[0] as Dictionary<string, object>;
            var message = GetObject(first, "message");
            var audioObject = GetObject(message, "audio");
            var nestedAudio = GetString(audioObject, "data");
            if (!string.IsNullOrWhiteSpace(nestedAudio)) return nestedAudio;

            var messageAudio = GetString(message, "audio");
            if (!string.IsNullOrWhiteSpace(messageAudio)) return messageAudio;
        }

        var audio = GetObject(data, "audio");
        var audioData = GetString(audio, "data");
        if (!string.IsNullOrWhiteSpace(audioData)) return audioData;

        var dataObject = GetObject(data, "data");
        var dataAudio = GetString(dataObject, "audio");
        if (!string.IsNullOrWhiteSpace(dataAudio)) return dataAudio;

        return string.Empty;
    }

    private static byte[] DecodeAudioPayload(string encoded)
    {
        var text = (encoded ?? string.Empty).Trim();
        text = System.Text.RegularExpressions.Regex.Replace(
            text,
            @"^data:audio\/\w+;base64,",
            string.Empty,
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);

        if (text.Length % 2 == 0 && System.Text.RegularExpressions.Regex.IsMatch(text, @"\A[0-9a-f]+\z", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
        {
            var bytes = new byte[text.Length / 2];
            for (var i = 0; i < bytes.Length; i++)
            {
                bytes[i] = Convert.ToByte(text.Substring(i * 2, 2), 16);
            }
            return bytes;
        }

        return Convert.FromBase64String(text);
    }

    private static string PickReply(Dictionary<string, object> data)
    {
        if (data == null) return string.Empty;
        var outputText = GetString(data, "output_text");
        if (!string.IsNullOrWhiteSpace(outputText)) return outputText;

        var output = GetArray(data, "output");
        if (output != null)
        {
            var lines = new List<string>();
            foreach (var item in output)
            {
                var itemData = item as Dictionary<string, object>;
                var content = GetArray(itemData, "content");
                if (content == null) continue;
                foreach (var block in content)
                {
                    var blockData = block as Dictionary<string, object>;
                    var type = GetString(blockData, "type");
                    if (type == "output_text" || type == "text")
                    {
                        lines.Add(GetString(blockData, "text"));
                    }
                }
            }
            var merged = string.Join("\n", lines).Trim();
            if (!string.IsNullOrWhiteSpace(merged)) return merged;
        }

        var choices = GetArray(data, "choices");
        if (choices != null && choices.Length > 0)
        {
            var first = choices[0] as Dictionary<string, object>;
            if (first != null)
            {
                object message;
                if (first.TryGetValue("message", out message))
                {
                    var messageData = message as Dictionary<string, object>;
                    var content = GetString(messageData, "content");
                    if (!string.IsNullOrWhiteSpace(content)) return content;
                }
                var text = GetString(first, "text");
                if (!string.IsNullOrWhiteSpace(text)) return text;
            }
        }

        return GetString(data, "reply");
    }

    private static string PostJson(string url, Dictionary<string, object> payload, Dictionary<string, string> headers)
    {
        return Encoding.UTF8.GetString(PostBytes(url, Json.Serialize(payload), headers).Body);
    }

    private static void PostJsonStream(string url, Dictionary<string, object> payload, Dictionary<string, string> headers, Action<byte[]> write)
    {
        var body = Json.Serialize(payload);
        var bytes = Encoding.UTF8.GetBytes(body ?? string.Empty);
        var request = (HttpWebRequest)WebRequest.Create(url);
        request.Method = "POST";
        request.ContentType = "application/json; charset=utf-8";
        request.Accept = "text/event-stream, application/json, */*";
        request.Timeout = 120000;
        request.ReadWriteTimeout = 120000;
        AddHeaders(request, headers);
        using (var requestStream = request.GetRequestStream())
        {
            requestStream.Write(bytes, 0, bytes.Length);
        }

        using (var response = (HttpWebResponse)request.GetResponse())
        using (var stream = response.GetResponseStream())
        {
            var contentType = response.ContentType ?? string.Empty;
            if (contentType.IndexOf("event-stream", StringComparison.OrdinalIgnoreCase) < 0 &&
                contentType.IndexOf("stream", StringComparison.OrdinalIgnoreCase) < 0)
            {
                ForwardPossiblyMislabelledStream(stream ?? Stream.Null, write);
                return;
            }

            var buffer = new byte[8192];
            while (true)
            {
                var read = stream == null ? 0 : stream.Read(buffer, 0, buffer.Length);
                if (read <= 0) break;
                var chunk = new byte[read];
                Buffer.BlockCopy(buffer, 0, chunk, 0, read);
                write(chunk);
            }
        }
    }

    private static void ForwardPossiblyMislabelledStream(Stream stream, Action<byte[]> write)
    {
        var buffer = new byte[8192];
        var read = stream.Read(buffer, 0, buffer.Length);
        if (read <= 0) return;

        if (LooksLikeSsePayload(buffer, read))
        {
            while (read > 0)
            {
                var chunk = new byte[read];
                Buffer.BlockCopy(buffer, 0, chunk, 0, read);
                write(chunk);
                read = stream.Read(buffer, 0, buffer.Length);
            }
            return;
        }

        using (var memory = new MemoryStream())
        {
            memory.Write(buffer, 0, read);
            while (true)
            {
                read = stream.Read(buffer, 0, buffer.Length);
                if (read <= 0) break;
                memory.Write(buffer, 0, read);
            }
            WriteSseEvent(write, "message", Encoding.UTF8.GetString(memory.ToArray()));
        }
    }

    private static bool LooksLikeSsePayload(byte[] buffer, int length)
    {
        var count = Math.Min(Math.Max(length, 0), 256);
        if (count <= 0) return false;
        var head = Encoding.UTF8.GetString(buffer, 0, count).TrimStart('\uFEFF', ' ', '\t', '\r', '\n');
        return head.StartsWith("data:", StringComparison.OrdinalIgnoreCase) ||
               head.StartsWith("event:", StringComparison.OrdinalIgnoreCase);
    }

    private static void WriteSseEvent(Action<byte[]> write, string eventName, string data)
    {
        var builder = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(eventName) && eventName != "message")
        {
            builder.Append("event: ").Append(eventName).Append("\n");
        }
        var value = data ?? string.Empty;
        var lines = value.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        foreach (var line in lines)
        {
            builder.Append("data: ").Append(line).Append("\n");
        }
        builder.Append("\n");
        write(Encoding.UTF8.GetBytes(builder.ToString()));
    }

    private static ProviderBytes PostBytes(string url, string body, Dictionary<string, string> headers)
    {
        var bytes = Encoding.UTF8.GetBytes(body ?? string.Empty);
        var request = (HttpWebRequest)WebRequest.Create(url);
        request.Method = "POST";
        request.ContentType = "application/json; charset=utf-8";
        request.Accept = "*/*";
        request.Timeout = 120000;
        request.ReadWriteTimeout = 120000;
        AddHeaders(request, headers);
        using (var requestStream = request.GetRequestStream())
        {
            requestStream.Write(bytes, 0, bytes.Length);
        }
        return ReadProviderResponse((HttpWebResponse)request.GetResponse());
    }

    private static ProviderBytes GetBytes(string url, Dictionary<string, string> headers)
    {
        var request = (HttpWebRequest)WebRequest.Create(url);
        request.Method = "GET";
        request.Accept = "*/*";
        request.Timeout = 120000;
        request.ReadWriteTimeout = 120000;
        AddHeaders(request, headers);
        return ReadProviderResponse((HttpWebResponse)request.GetResponse());
    }

    private static void AddHeaders(HttpWebRequest request, Dictionary<string, string> headers)
    {
        if (headers == null) return;
        foreach (var header in headers)
        {
            if (header.Key.Equals("Authorization", StringComparison.OrdinalIgnoreCase))
            {
                request.Headers[HttpRequestHeader.Authorization] = header.Value;
            }
            else
            {
                request.Headers[header.Key] = header.Value;
            }
        }
    }

    private static ProviderBytes ReadProviderResponse(HttpWebResponse response)
    {
        using (response)
        using (var stream = response.GetResponseStream())
        using (var memory = new MemoryStream())
        {
            stream.CopyTo(memory);
            return new ProviderBytes
            {
                Body = memory.ToArray(),
                ContentType = response.ContentType
            };
        }
    }

    private static int GetStatusCode(WebException ex, int fallback)
    {
        var response = ex.Response as HttpWebResponse;
        return response == null ? fallback : (int)response.StatusCode;
    }

    private static string ReadWebException(WebException ex)
    {
        var response = ex.Response;
        if (response == null)
        {
            return ex.Message;
        }
        using (response)
        using (var stream = response.GetResponseStream())
        using (var reader = new StreamReader(stream ?? Stream.Null, Encoding.UTF8))
        {
            var text = reader.ReadToEnd();
            return string.IsNullOrWhiteSpace(text) ? ex.Message : text;
        }
    }

    private static StudioApiResponse JsonOk(object payload)
    {
        return new StudioApiResponse
        {
            StatusCode = 200,
            StatusText = "OK",
            ContentType = "application/json; charset=utf-8",
            Body = Encoding.UTF8.GetBytes(Json.Serialize(payload))
        };
    }

    private static StudioApiResponse JsonError(int statusCode, string message)
    {
        return new StudioApiResponse
        {
            StatusCode = statusCode,
            StatusText = statusCode == 400 ? "Bad Request" : "Error",
            ContentType = "application/json; charset=utf-8",
            Body = Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object>
            {
                { "success", false },
                { "message", message ?? "Request failed" }
            }))
        };
    }
}

internal sealed class ProviderBytes
{
    public byte[] Body;
    public string ContentType;
}
