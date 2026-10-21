using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using CrossPet;

sealed class Fixture : IDisposable
{
    public readonly string Root = Path.Combine(Path.GetTempPath(), "crosspet-follow-" + Guid.NewGuid().ToString("N"));
    public readonly Pet Pet = new Pet();
    long stamp = DateTime.UtcNow.Ticks;
    public Fixture()
    {
        Directory.CreateDirectory(Root);
        Store.State = Root;
        Store.AppMap = Path.Combine(Root, "apps.json");
        Store.Settings = new System.Collections.Generic.Dictionary<string, object> { ["followApps"] = true, ["followEvents"] = true };
        File.WriteAllText(Store.AppMap, "{\"cursor.exe\":\"cursor\"}");
        Native.Exe = "terminal.exe";
    }
    public void Host(string role)
    {
        var path = Path.Combine(Root, "cursor-host.json");
        File.WriteAllText(path, Store.Json.Serialize(new { character = role }));
        File.SetLastWriteTimeUtc(path, new DateTime(stamp += TimeSpan.TicksPerSecond, DateTimeKind.Utc));
    }
    public void State(string role)
    {
        var path = Path.Combine(Root, role + "-state.json");
        File.WriteAllText(path, Store.Json.Serialize(new { pose = "reading", @event = "PreToolUse", ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0 }));
        File.SetLastWriteTimeUtc(path, new DateTime(stamp += TimeSpan.TicksPerSecond, DateTimeKind.Utc));
    }
    public void Dispose() { try { Directory.Delete(Root, true); } catch { } }
}

static class Program
{
    static int passed, failed;
    static void Equal(string expected, string actual)
    {
        if (expected != actual) throw new Exception("expected " + expected + ", actual " + actual);
    }
    static void Count(int expected, int actual)
    {
        if (expected != actual) throw new Exception("expected count " + expected + ", actual " + actual);
    }
    static async Task Complete(Pet pet, int index, bool allowed = true)
    {
        pet.Requests[index].Reply.SetResult(allowed ? "true" : "false");
        await Task.Delay(30);
    }
    static async Task Check(string name, Func<Task> body)
    {
        try { await body(); passed++; Console.WriteLine("PASS " + name); }
        catch (Exception error) { failed++; Console.WriteLine("FAIL " + name + ": " + error.Message); }
    }

    static async Task<int> Main()
    {
        await Check("first Cursor host record immediately replaces fallback", () => {
            using (var f = new Fixture()) {
                Native.Exe = "cursor.exe"; f.Pet.Activate(); Equal("gpt", f.Pet.Selected);
                f.Host("grok"); f.Pet.Tick(); Equal("grok", f.Pet.Selected);
            } return Task.CompletedTask;
        });
        await Check("unchanged host route does not repeatedly reselect", () => {
            using (var f = new Fixture()) {
                Native.Exe = "cursor.exe"; f.Host("grok"); f.Pet.Tick();
                f.Pet.Choose("claude"); f.Pet.Tick(); Equal("claude", f.Pet.Selected);
            } return Task.CompletedTask;
        });
        await Check("changed Cursor route follows its new model", () => {
            using (var f = new Fixture()) {
                Native.Exe = "cursor.exe"; f.Host("grok"); f.Pet.Tick();
                f.Host("deepseek"); f.Pet.Tick(); Equal("deepseek", f.Pet.Selected);
            } return Task.CompletedTask;
        });
        await Check("B then C evaluations only apply newest event when B returns first", async () => {
            using (var f = new Fixture()) {
                f.State("claude"); f.Pet.Tick(); f.State("deepseek"); f.Pet.Tick(); Count(2, f.Pet.Requests.Count);
                await Complete(f.Pet, 0); Equal("gpt", f.Pet.Selected);
                await Complete(f.Pet, 1); Equal("deepseek", f.Pet.Selected);
            }
        });
        await Check("B then C evaluations only apply newest event when C returns first", async () => {
            using (var f = new Fixture()) {
                f.State("claude"); f.Pet.Tick(); f.State("deepseek"); f.Pet.Tick();
                await Complete(f.Pet, 1); await Complete(f.Pet, 0); Equal("deepseek", f.Pet.Selected);
            }
        });
        await Check("new event for current A cancels pending B", async () => {
            using (var f = new Fixture()) {
                f.State("claude"); f.Pet.Tick(); f.State("gpt"); f.Pet.Tick();
                Count(1, f.Pet.Requests.Count); await Complete(f.Pet, 0); Equal("gpt", f.Pet.Selected);
            }
        });
        await Check("manual A to B to A rejects stale request", async () => {
            using (var f = new Fixture()) {
                f.State("claude"); f.Pet.Tick(); f.Pet.Choose("deepseek"); f.Pet.Choose("gpt");
                await Complete(f.Pet, 0); Equal("gpt", f.Pet.Selected);
            }
        });
        await Check("manual choice of current A rejects stale request", async () => {
            using (var f = new Fixture()) {
                f.State("claude"); f.Pet.Tick(); f.Pet.Choose("gpt");
                await Complete(f.Pet, 0); Equal("gpt", f.Pet.Selected);
            }
        });
        await Check("same executable host route changed before callback is rechecked", async () => {
            using (var f = new Fixture()) {
                f.Pet.Catalog.RemoveAll(c => c.id == "gpt"); f.Pet.Choose("claude"); Native.Exe = "cursor.exe";
                f.State("deepseek"); f.Pet.Tick(); Count(1, f.Pet.Requests.Count);
                f.Host("grok"); await Complete(f.Pet, 0); Equal("claude", f.Pet.Selected);
            }
        });
        await Check("foreground executable change cancels request", async () => {
            using (var f = new Fixture()) {
                f.State("claude"); f.Pet.Tick(); Native.Exe = "cursor.exe";
                await Complete(f.Pet, 0); Equal("gpt", f.Pet.Selected);
            }
        });
        await Check("following setting change cancels request", async () => {
            using (var f = new Fixture()) {
                f.State("claude"); f.Pet.Tick(); Store.Settings["followEvents"] = false;
                await Complete(f.Pet, 0); Equal("gpt", f.Pet.Selected);
            }
        });
        await Check("unrelated background host route does not cancel pending terminal event", async () => {
            using (var f = new Fixture()) {
                f.State("claude"); f.Pet.Tick();
                File.WriteAllText(Path.Combine(f.Root,"workbuddy-host.json"),"{\"character\":\"deepseek\"}");
                f.Pet.Tick(); Count(1, f.Pet.Requests.Count);
                await Complete(f.Pet, 0); Equal("claude", f.Pet.Selected);
            }
        });
        await Check("reload and ready again cancel old page callback", async () => {
            using (var f = new Fixture()) {
                f.State("claude"); f.Pet.Tick(); f.Pet.Reload(); f.Pet.ReadyAgain();
                await Complete(f.Pet, 0); Equal("gpt", f.Pet.Selected);
            }
        });
        Console.WriteLine("RESULT passed=" + passed + " failed=" + failed);
        return failed == 0 ? 0 : 1;
    }
}
