let { exists, scripts } = (await cli("fns"));
let script = await arg(`Which script do you want to duplicate?`, scripts);
let newScript = await arg({
    placeholder: `Enter the new script name:`,
    validate: exists,
});
let oldFilePath = path.join(kenvPath("scripts"), script);
if (!(await isFile(oldFilePath))) {
    console.warn(`${oldFilePath} doesn't exist...`);
    exit();
}
let newFilePath = path.join(kenvPath("scripts"), newScript + ".js");
cp(oldFilePath, newFilePath);
await cli("create-bin", "scripts", newScript);
edit(newFilePath, kenvPath());
export {};
