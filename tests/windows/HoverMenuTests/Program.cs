// Windows only: exercise the built native menu without opening a desktop window.
using System;
using System.Collections;
using System.IO;
using System.Reflection;
using System.Runtime.Serialization;
using System.Runtime.Versioning;
using System.Windows.Forms;

static class Program
{
    const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
    static Type petType, companionType;
    static int passed;
    static object Get(object pet, string field) => petType.GetField(field, Private).GetValue(pet);
    static void Set(object pet, string field, object value) => petType.GetField(field, Private).SetValue(pet, value);
    static object Call(object pet, string name, params object[] args) => petType.GetMethod(name, Private).Invoke(pet, args);
    static void Check(string name, bool ok)
    {
        if (!ok) throw new Exception(name);
        passed++; Console.WriteLine("PASS " + name);
    }
    static object Pet()
    {
        var pet = FormatterServices.GetUninitializedObject(petType);
        Set(pet, "current", "claude");
        var actions = petType.GetField("hoverActions", Private);
        actions.SetValue(pet, Activator.CreateInstance(actions.FieldType));
        return pet;
    }
    static object Companion(string role)
    {
        var owner = FormatterServices.GetUninitializedObject(companionType);
        companionType.GetField("<Character>k__BackingField", Private).SetValue(owner, role);
        return owner;
    }

    [STAThread]
    static int Main()
    {
        try
        {
            var assembly = Assembly.LoadFrom(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "CrossPet.exe"));
            var framework = (TargetFrameworkAttribute)Attribute.GetCustomAttribute(assembly, typeof(TargetFrameworkAttribute));
            Check("SDK preserves the desktop framework target", framework?.FrameworkName == ".NETFramework,Version=v4.8");
            petType = assembly.GetType("CrossPet.Pet", true);
            companionType = assembly.GetType("CrossPet.Companion", true);
            var pet = Pet(); var owner = Companion("deepseek"); var other = Companion("gpt");
            Set(pet, "hoverCompanion", owner); Set(pet, "hoverOpening", true); Set(pet, "hoverNonce", "old-request");
            Call(pet, "CloseCompanionHover", other);
            Check("unrelated companion cannot cancel a pending owner", (int)Get(pet, "hoverGeneration") == 0 && ReferenceEquals(Get(pet, "hoverCompanion"), owner));
            Call(pet, "CloseHoverMenuForLookChange", true);
            Check("main character change preserves a companion menu", (int)Get(pet, "hoverGeneration") == 0);
            Call(pet, "CloseCompanionHover", owner);
            Check("closing pending owner invalidates the async generation", (int)Get(pet, "hoverGeneration") == 1);
            Check("pending owner and nonce released before continuation", Get(pet, "hoverCompanion") == null && Get(pet, "hoverNonce") == null);
            var ownerCharacter = petType.GetProperty("HoverOwnerCharacter", Private);
            Check("dismissal returns ownership to the main pet", (string)ownerCharacter.GetValue(pet) == "claude");

            using (var menu = new ContextMenuStrip())
            {
                int clicks = 0;
                var enabled = new ToolStripMenuItem("Enabled", null, (_, __) => clicks++);
                var disabled = new ToolStripMenuItem("Disabled") { Enabled = false };
                var parent = new ToolStripMenuItem("Disabled parent") { Enabled = false };
                parent.DropDownItems.Add(new ToolStripMenuItem("Child"));
                menu.Items.AddRange(new ToolStripItem[] { enabled, disabled, parent });
                Call(pet, "HoverMenuItems", menu.Items, true);
                var actions = (IDictionary)Get(pet, "hoverActions");
                Check("disabled leaves and disabled ancestor branches are not invokable", actions.Count == 1);
                foreach (ToolStripMenuItem action in actions.Values)
                {
                    Check("hover menu reuses the original action", ReferenceEquals(action, enabled));
                    action.PerformClick();
                }
                Check("original delegate runs once", clicks == 1);
                Call(pet, "CloseHoverMenu");
                Check("closing clears all stale action IDs", actions.Count == 0);
            }
            Console.WriteLine(passed + " checks passed");
            return 0;
        }
        catch (Exception e) { Console.Error.WriteLine(e); return 1; }
    }
}
