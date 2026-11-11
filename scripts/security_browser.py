"""Windows Edge browser security smoke, using isolated local WSL test fixtures."""
import json
import os
from pathlib import Path
import subprocess
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get("SECURITY_BROWSER_BASE_URL", "http://localhost:18080").rstrip("/")
ADMIN = "http://localhost:18081"


class AppPage:
    def __init__(self,page): self.page = page
    def login(self,username,password):
        self.page.goto(BASE+"/login")
        self.page.get_by_label("Usuario",exact=True).fill(username)
        self.page.get_by_label("Contraseña",exact=True).fill(password)
        self.page.get_by_role("button",name="Entrar a mi cuenta").click()
        expect(self.page).to_have_url(BASE+"/analisis")
    def show_private_map(self,url):
        analysis_id = url.split('/')[3]
        self.page.goto(BASE+"/analisis/"+analysis_id+"?vista=mapa")
        self.page.get_by_role("combobox",name="Capa",exact=True).select_option("ndvi")


def main():
    # Credentials stay in memory in this process and an isolated browser profile.
    command = "cd /mnt/c/Users/bq/Documents/ChatGPT/QuenarisTerranode/quenaris_mvp && GEE_OAUTH_DIRECTORY=/mnt/c/Users/bq/.config/earthengine docker compose -f compose.integration.yml run --rm --no-deps tests python scripts/security_seed.py"
    result = subprocess.run(["wsl","-d","Ubuntu","--","sh","-lc",command],capture_output=True,text=True,check=True)
    fixture = json.loads(result.stdout[result.stdout.index("{"):])
    report = {"timestamp_utc":datetime.now(timezone.utc).isoformat(),"browser":"Edge headless, isolated context"}
    with sync_playwright() as p:
        browser=p.chromium.launch(channel="msedge",headless=True,args=["--enable-unsafe-swiftshader","--use-angle=swiftshader"])
        report["browser_version"] = browser.version
        context=browser.new_context()
        page=context.new_page()
        leaked=[]
        page.on("request",lambda r: leaked.append(r.url) if not r.url.startswith(BASE) and r.headers.get("authorization") else None)
        app=AppPage(page)
        app.login(fixture["username"],fixture["password"])
        assert page.evaluate("localStorage.getItem('gi_token')") is None
        assert page.evaluate("Boolean(sessionStorage.getItem('gi_token'))")
        with page.expect_response(lambda r:r.url==BASE+fixture["image_url"]) as received:
            app.show_private_map(fixture["image_url"])
        assert received.value.status == 200
        assert "no-store" in received.value.headers.get("cache-control","")
        assert received.value.request.headers.get("authorization","").startswith("Token ")
        assert not leaked
        report.update(ui_login=True,maplibre_private_image=True,no_token_in_local_storage=True,no_external_token_leak=True)
        page.goto(BASE+"/analisis/"+fixture["analysis_id"]+"/informe")
        expect(page.get_by_role("heading",name='<img src=x onerror="window.__storedXss=1">',exact=True,level=1)).to_be_visible()
        assert page.evaluate("window.__storedXss") is None
        report["stored_name_rendered_as_text"]=True
        response=context.request.get(BASE+fixture["image_url"],headers={"Authorization":"Token "+fixture["other_token"]})
        assert response.status==404
        anonymous=browser.new_context()
        assert anonymous.request.get(BASE+fixture["image_url"]).status==401
        assert anonymous.request.get(BASE+"/admin/").status==404
        anonymous.close()
        page.goto(ADMIN+"/admin/login/")
        page.get_by_label("Nombre de usuario:").fill(fixture["admin_username"])
        page.get_by_label("Contraseña:").fill(fixture["admin_password"])
        page.get_by_role("button",name="Iniciar sesión").click()
        expect(page).to_have_url(ADMIN+"/admin/")
        assert context.request.get(BASE+"/admin/").status==404
        report.update(private_admin_login=True,public_admin_blocked_even_with_admin_cookie=True,foreign_image_denied=True,anonymous_image_denied=True)
        page.goto(BASE+"/perfil")
        old_token = page.evaluate("sessionStorage.getItem('gi_token')")
        page.get_by_role("button",name="Cerrar sesión",exact=True).click()
        expect(page).to_have_url(BASE+"/login")
        assert page.evaluate("sessionStorage.getItem('gi_token')") is None
        assert context.request.get(BASE+"/api/analyses/",headers={"Authorization":"Token "+old_token}).status==401
        report["logout_clears_session"]=True
        report["logout_revokes_server_token"]=True
        browser.close()
    output=ROOT/"docs/frontend/security-browser.json"
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps(report,indent=2))


if __name__=="__main__":
    main()
